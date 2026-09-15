"""Refresh expiring Shopify offline access tokens before they die.

Runs automatically in-process every REFRESH_INTERVAL_SECONDS (see
app/main.py's lifespan) - the app is deployed as a single always-on
machine with a single uvicorn worker, so this loop runs exactly once,
no external scheduler needed. scripts/refresh_tokens.py remains as a
thin CLI wrapper around refresh_due_connections for a manual/on-demand run.

backend-fastapi is the sole owner of this refresh cycle (see
../../frontend/app/shopify.server.js's future flag comment for why - the
frontend app's own session refreshes independently, and Shopify's docs warn
that two independent refreshers for the same store retire each other's
token). A connection whose refresh_token Shopify rejects gets is_connected
set to false rather than silently failing forever - that's what the merchant
sees on the OMS side as "needs reauthorization".
"""
from datetime import datetime, timedelta, timezone

from . import shopify_client

# Refresh anything expiring within this window, or with no known expiry at
# all (access_token_expires_at NULL - shouldn't happen for a row that has a
# refresh_token, but don't skip it silently if it does).
REFRESH_BEFORE = timedelta(hours=6)

REFRESH_INTERVAL_SECONDS = 30 * 60


async def _refresh_one(pool, row) -> None:
    shop_domain = row["shop_domain"]
    try:
        result = await shopify_client.refresh_access_token(shop_domain, row["refresh_token"])
    except shopify_client.InvalidRefreshTokenError as exc:
        print(f"[refresh] {shop_domain}: refresh token dead, flagging for reauthorization - {exc}")
        await pool.execute(
            "update integrations.shopify_connections set is_connected = false, updated_at = now() where id = $1",
            row["id"],
        )
        return
    except shopify_client.ShopifyAPIError as exc:
        # Transient - leave the row alone, next cycle retries with the same
        # still-valid refresh_token.
        print(f"[refresh] {shop_domain}: refresh failed, will retry next cycle - {exc}")
        return

    await pool.execute(
        """
        update integrations.shopify_connections
           set access_token = $2,
               refresh_token = $3,
               access_token_expires_at = $4,
               refresh_token_expires_at = $5,
               updated_at = now()
         where id = $1
        """,
        row["id"],
        result["access_token"],
        result["refresh_token"],
        result["access_token_expires_at"],
        result["refresh_token_expires_at"],
    )
    print(f"[refresh] {shop_domain}: refreshed, new access token expires {result['access_token_expires_at']}")


async def refresh_due_connections(pool) -> None:
    cutoff = datetime.now(timezone.utc) + REFRESH_BEFORE
    rows = await pool.fetch(
        """
        select id, shop_domain, refresh_token
          from integrations.shopify_connections
         where is_connected = true
           and refresh_token != ''
           and (access_token_expires_at is null or access_token_expires_at < $1)
        """,
        cutoff,
    )
    if not rows:
        print("[refresh] nothing due for refresh")
        return
    print(f"[refresh] {len(rows)} connection(s) due")
    for row in rows:
        await _refresh_one(pool, row)
