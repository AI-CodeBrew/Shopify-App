from datetime import datetime, timedelta, timezone

import httpx

from .config import settings

# New public Shopify apps are required to use the GraphQL Admin API (REST
# order endpoints are legacy) - see backend/OMS-PATCH.md "Things to decide
# before this goes live" #3. This client is GraphQL-only from the start,
# except refresh_access_token below - token refresh is only exposed as a
# REST-shaped OAuth endpoint (/admin/oauth/access_token), there's no
# GraphQL equivalent.
_TOPIC_ENUM = {
    "orders/create": "ORDERS_CREATE",
    "orders/updated": "ORDERS_UPDATED",
}


class ShopifyAPIError(Exception):
    pass


class InvalidRefreshTokenError(ShopifyAPIError):
    """The stored refresh_token is dead - most likely retired by the frontend
    app's own independent refresh cycle (see shopify.server.js's future flag
    comment) or the merchant revoked/reinstalled. Not retryable; the caller
    should flag the connection as needing reauthorization, not retry.
    """


def _endpoint(shop_domain: str, api_version: str) -> str:
    return f"https://{shop_domain}/admin/api/{api_version}/graphql.json"


async def _graphql(shop_domain: str, access_token: str, api_version: str, query: str, variables: dict) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            _endpoint(shop_domain, api_version),
            json={"query": query, "variables": variables},
            headers={
                "X-Shopify-Access-Token": access_token,
                "Content-Type": "application/json",
            },
        )
    if resp.status_code != 200:
        raise ShopifyAPIError(f"Shopify API returned {resp.status_code}: {resp.text[:500]}")

    body = resp.json()
    if "errors" in body:
        raise ShopifyAPIError(f"Shopify GraphQL errors: {body['errors']}")
    return body["data"]


async def fetch_shop_info(shop_domain: str, access_token: str, api_version: str) -> dict:
    """Verifies the token is live and returns {name, currency}."""
    data = await _graphql(
        shop_domain,
        access_token,
        api_version,
        "query { shop { name myshopifyDomain currencyCode } }",
        {},
    )
    shop = data["shop"]
    return {"name": shop["name"], "currency": shop["currencyCode"]}


async def register_webhook(
    shop_domain: str, access_token: str, api_version: str, topic: str, callback_url: str
) -> str:
    """Registers one webhook subscription, returns its GraphQL id (gid://...)."""
    enum_topic = _TOPIC_ENUM.get(topic)
    if not enum_topic:
        raise ShopifyAPIError(f"Unknown webhook topic: {topic}")

    mutation = """
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }
    """
    data = await _graphql(
        shop_domain,
        access_token,
        api_version,
        mutation,
        {
            "topic": enum_topic,
            "webhookSubscription": {"callbackUrl": callback_url, "format": "JSON"},
        },
    )
    result = data["webhookSubscriptionCreate"]
    if result["userErrors"]:
        raise ShopifyAPIError(f"webhookSubscriptionCreate errors: {result['userErrors']}")
    return result["webhookSubscription"]["id"]


async def refresh_access_token(shop_domain: str, refresh_token: str) -> dict:
    """Exchanges a stored refresh_token for a new access_token + refresh_token.

    Mirrors @shopify/shopify-api's lib/auth/oauth/refresh-token.js exactly:
    POST /admin/oauth/access_token with grant_type=refresh_token. Every
    refresh returns a NEW refresh_token - the old one stays valid for a grace
    period (per Shopify's docs) but the caller must persist the new one and
    use it next time, or refreshes will eventually fail once the grace period
    lapses.

    Raises InvalidRefreshTokenError if Shopify rejects the refresh_token
    itself (dead/rotated-elsewhere/revoked) rather than a transient failure.
    """
    body = {
        "client_id": settings.shopify_api_key,
        "client_secret": settings.shopify_api_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"https://{shop_domain}/admin/oauth/access_token",
            json=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )

    if resp.status_code == 400:
        # Shopify returns 400 + {"error": "invalid_grant"} (or similar) for a
        # refresh_token it no longer recognizes - not a transient failure.
        raise InvalidRefreshTokenError(f"Shopify rejected the refresh token: {resp.text[:500]}")
    if resp.status_code != 200:
        raise ShopifyAPIError(f"Shopify token refresh returned {resp.status_code}: {resp.text[:500]}")

    payload = resp.json()
    # Redacted diagnostic of the raw response shape - not the secret values
    # themselves. If a required key is ever actually missing, the KeyError
    # below still fires; this just tells you which keys Shopify sent before
    # that happens, without putting real tokens in application logs.
    print(
        "[shopify_client.refresh_access_token] raw response keys:",
        {k: (f"present, len={len(v)}" if isinstance(v, str) else v) for k, v in payload.items()},
    )
    for required in ("access_token", "refresh_token", "expires_in", "refresh_token_expires_in"):
        if required not in payload:
            raise ShopifyAPIError(f"Shopify token refresh response is missing '{required}': keys={list(payload.keys())}")

    now = datetime.now(timezone.utc)
    return {
        "access_token": payload["access_token"],
        "refresh_token": payload["refresh_token"],
        "access_token_expires_at": now + timedelta(seconds=payload["expires_in"]),
        "refresh_token_expires_at": now + timedelta(seconds=payload["refresh_token_expires_in"]),
    }
