import base64
import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, HTTPException, Request, Response, status

from ..db import get_pool

logger = logging.getLogger("fynktech.webhooks")

router = APIRouter(prefix="/webhooks/shopify", tags=["webhooks"])


@router.post("/orders")
async def shopify_order_webhook(request: Request) -> Response:
    """Receiver for the orders/create + orders/updated webhooks this service
    registers in routers/pending.py::connect_pending.

    Testing-scope stub: verifies the HMAC and acknowledges. Turning the
    payload into real OMS order rows is separate business logic that belongs
    in the OMS itself (see backend/OMS-PATCH.md), not in this connector.
    """
    body = await request.body()
    hmac_header = request.headers.get("X-Shopify-Hmac-Sha256", "")
    shop_domain = request.headers.get("X-Shopify-Shop-Domain", "")
    topic = request.headers.get("X-Shopify-Topic", "")

    if not hmac_header or not shop_domain:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Shopify webhook headers")

    pool = get_pool()
    secret = await pool.fetchval(
        "select webhook_secret from integrations.shopify_connections where shop_domain = $1",
        shop_domain,
    )
    if not secret:
        # Shopify retries on non-2xx, but a shop we've never connected is not
        # a transient failure - 404 tells it to stop, not retry forever.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown shop")

    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    computed = base64.b64encode(digest).decode("utf-8")
    if not hmac.compare_digest(computed, hmac_header):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid HMAC signature")

    payload = json.loads(body or b"{}")
    logger.info("shopify webhook topic=%s shop=%s order_id=%s", topic, shop_domain, payload.get("id"))

    return Response(status_code=status.HTTP_200_OK)
