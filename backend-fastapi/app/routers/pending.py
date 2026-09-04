import re
import uuid

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from .. import shopify_client
from ..auth import AuthContext, require_org
from ..config import settings
from ..db import get_pool
from ..schemas import ConnectResult, PendingStatus, StartInstall, StartInstallResult

router = APIRouter(prefix="/api/integrations/shopify", tags=["shopify"])

_SHOP_DOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\.myshopify\.com$")


@router.post("/start", response_model=StartInstallResult, status_code=status.HTTP_200_OK)
async def start_install(payload: StartInstall, ctx: AuthContext = Depends(require_org)) -> StartInstallResult:
    """Reserve a shop for this organization *before* the merchant leaves for
    Shopify, so the install this kicks off can be matched deterministically
    on the way back - no guessing by email required.

    Writes a pre-assigned row into integrations.shopify_pending_installs.
    ../frontend's auth/callback route (savePendingInstall, on:conflict
    shop_domain) preserves organization_id if one is already set here, so
    this row's org "wins" over the auth callback's own (now unused)
    organization_id=null default.
    """
    shop_domain = payload.shop_domain.strip().lower()
    if not _SHOP_DOMAIN_RE.match(shop_domain):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter a valid *.myshopify.com store domain.",
        )

    pool = get_pool()
    org_id = uuid.UUID(ctx.organization_id)

    clash = await pool.fetchval(
        "select 1 from integrations.shopify_connections where shop_domain = $1 and organization_id != $2",
        shop_domain,
        org_id,
    )
    if clash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Shopify store is already connected to another organization.",
        )

    try:
        await pool.execute(
            """
            insert into integrations.shopify_pending_installs
                (shop_domain, organization_id, match_method, status)
            values ($1, $2, 'claimed', 'pending')
            on conflict (shop_domain) do update set
                organization_id = coalesce(
                                    integrations.shopify_pending_installs.organization_id,
                                    excluded.organization_id),
                match_method    = case
                                     when integrations.shopify_pending_installs.organization_id is not null
                                       then integrations.shopify_pending_installs.match_method
                                     else excluded.match_method
                                   end,
                status          = 'pending',
                uninstalled_at  = null,
                updated_at      = now()
            """,
            shop_domain,
            org_id,
        )
    except asyncpg.UndefinedTableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "integrations.shopify_pending_installs does not exist. Apply the OMS "
                "migration, or run `npm run oms:bootstrap` from ../frontend."
            ),
        ) from exc

    if not settings.shopify_app_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SHOPIFY_APP_URL is not configured on this service.",
        )

    install_url = f"{settings.shopify_app_url.rstrip('/')}/auth?shop={shop_domain}"
    return StartInstallResult(install_url=install_url)


async def _fetch_pending(pool, organization_id: uuid.UUID):
    try:
        return await pool.fetchrow(
            """
            select shop_domain, shop_name, currency, access_token, webhook_secret,
                   refresh_token, access_token_expires_at, refresh_token_expires_at,
                   scopes, installed_at, installed_by_email
              from integrations.shopify_pending_installs
             where organization_id = $1 and status = 'pending'
             order by installed_at desc
             limit 1
            """,
            organization_id,
        )
    except asyncpg.UndefinedTableError as exc:
        # Same condition ../frontend/app/oms.server.js raises OmsSchemaMissingError
        # for: the staging table hasn't been created yet.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "integrations.shopify_pending_installs does not exist. Apply the OMS "
                "migration in backend/integrations/migrations/, or run `npm run "
                "oms:bootstrap` from ../frontend."
            ),
        ) from exc


@router.get("/pending", response_model=PendingStatus)
async def get_pending(ctx: AuthContext = Depends(require_org)) -> PendingStatus:
    pool = get_pool()
    row = await _fetch_pending(pool, uuid.UUID(ctx.organization_id))
    if not row:
        return PendingStatus(pending=False)

    scope_count = len([s for s in (row["scopes"] or "").split(",") if s.strip()])
    return PendingStatus(
        pending=True,
        shop_domain=row["shop_domain"],
        shop_name=row["shop_name"],
        currency=row["currency"],
        installed_at=row["installed_at"],
        installed_by_email=row["installed_by_email"],
        scope_count=scope_count,
    )


@router.post("/pending", response_model=ConnectResult, status_code=status.HTTP_201_CREATED)
async def connect_pending(ctx: AuthContext = Depends(require_org)) -> ConnectResult:
    """Promote the staged install into a real ShopifyConnection.

    Mirrors backend/integrations/views_addition.py::ShopifyPendingInstallView.post
    from the Django patch proposal: verify the token against the shop, register
    the order webhooks, then upsert integrations.shopify_connections. Shopify
    calls are made *outside* the DB transaction that follows so a slow/blocked
    Admin API call never holds a pooled connection open.
    """
    pool = get_pool()
    org_id = uuid.UUID(ctx.organization_id)

    pending = await _fetch_pending(pool, org_id)
    if not pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Shopify app install is waiting for this organization.",
        )
    if not pending["access_token"] or not pending["webhook_secret"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The stored credentials are incomplete - reinstall the FynkTech AI app on your Shopify store.",
        )

    shop_domain = pending["shop_domain"]
    access_token = pending["access_token"]

    # A store domain is globally unique across the whole OMS.
    clash = await pool.fetchval(
        "select 1 from integrations.shopify_connections where shop_domain = $1 and organization_id != $2",
        shop_domain,
        org_id,
    )
    if clash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Shopify store is already connected to another organization.",
        )

    try:
        shop_info = await shopify_client.fetch_shop_info(shop_domain, access_token, settings.shopify_api_version)
    except shopify_client.ShopifyAPIError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    webhook_url = f"{settings.public_backend_url.rstrip('/')}/webhooks/shopify/orders"
    webhook_ids: list[str] = []
    warnings: list[str] = []
    for topic in ("orders/create", "orders/updated"):
        try:
            webhook_id = await shopify_client.register_webhook(
                shop_domain, access_token, settings.shopify_api_version, topic, webhook_url
            )
            webhook_ids.append(webhook_id)
        except shopify_client.ShopifyAPIError as exc:
            warnings.append(str(exc))

    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                insert into integrations.shopify_connections
                    (organization_id, shop_domain, shop_name, access_token, refresh_token,
                     access_token_expires_at, refresh_token_expires_at, webhook_secret,
                     currency, is_connected, webhooks_active, webhook_ids, auto_sync_orders,
                     created_at, updated_at)
                values
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11::jsonb, true, now(), now())
                on conflict (organization_id) do update set
                    shop_domain              = excluded.shop_domain,
                    shop_name                = excluded.shop_name,
                    access_token             = excluded.access_token,
                    refresh_token            = excluded.refresh_token,
                    access_token_expires_at  = excluded.access_token_expires_at,
                    refresh_token_expires_at = excluded.refresh_token_expires_at,
                    webhook_secret           = excluded.webhook_secret,
                    currency                 = excluded.currency,
                    is_connected             = true,
                    webhooks_active          = excluded.webhooks_active,
                    webhook_ids              = excluded.webhook_ids,
                    updated_at               = now()
                returning *
                """,
                org_id,
                shop_domain,
                shop_info["name"],
                access_token,
                pending["refresh_token"],
                pending["access_token_expires_at"],
                pending["refresh_token_expires_at"],
                pending["webhook_secret"],
                shop_info["currency"],
                bool(webhook_ids) and not warnings,
                webhook_ids,
                # NOTE: auto_sync_orders has no DB default and the real
                # ShopifyConnection Django model isn't in this repo, so `true`
                # here is an assumption for a fresh connect - only applied on
                # INSERT (the ON CONFLICT branch above doesn't touch it, so an
                # existing preference on reconnect is preserved either way).
            )

            await conn.execute(
                """
                update integrations.shopify_pending_installs
                   set status = 'connected', updated_at = now()
                 where shop_domain = $1
                """,
                shop_domain,
            )

    return ConnectResult(
        id=row["id"],
        organization_id=str(row["organization_id"]),
        shop_domain=row["shop_domain"],
        shop_name=row["shop_name"],
        currency=row["currency"],
        is_connected=row["is_connected"],
        webhooks_active=row["webhooks_active"],
        webhook_ids=row["webhook_ids"],
        auto_sync_orders=row["auto_sync_orders"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        webhook_url=webhook_url,
        webhook_warnings=warnings,
    )
