"""APPEND this view to backend/integrations/views.py, and add the two imports
plus the url in urls_addition.py.

It adds one endpoint:

    GET  /api/integrations/shopify/pending/   - is there a staged install for my org?
    POST /api/integrations/shopify/pending/   - promote it into a real connection

The POST is the "merchant just clicks Connect" path. It does exactly what
ShopifyConnectionView.post already does - verify the token against shop.json,
register the order webhooks, upsert ShopifyConnection - but reads the three
credentials from the staged row instead of from request.data, so nobody has to
paste an shpat_ token by hand.

NOTE ON DUPLICATION: the connect block below is a near-copy of
ShopifyConnectionView.post. That was the smallest additive change. The cleaner
end state is to extract those ~30 lines into
`services.establish_shopify_connection(organization_id, shop_domain,
access_token, webhook_secret)` and have both views call it - see
OMS-PATCH.md, "Optional refactor".
"""

from django.conf import settings
from django.urls import reverse
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import RequireModule

from . import shopify_client
from .models import ShopifyConnection, ShopifyPendingInstall
from .serializers import ShopifyConnectionSerializer


class ShopifyPendingInstallView(APIView):
    """One-click connect for stores that installed the FynkTech AI Shopify app.

    Every queryset here filters organization_id explicitly. ShopifyPendingInstall
    is NOT a TenantScopedModel (its organization is nullable), so it gets no
    automatic tenant scoping from TenantManager - forgetting the filter would
    hand one merchant's Admin token to another tenant.
    """

    permission_classes = [RequireModule]
    required_module = "oms"

    def _pending_for_org(self, request):
        return (
            ShopifyPendingInstall.objects.filter(
                organization_id=request.organization_id, status="pending"
            )
            .order_by("-installed_at")
            .first()
        )

    def get(self, request):
        pending = self._pending_for_org(request)
        if not pending:
            return Response({"pending": False})
        return Response(
            {
                "pending": True,
                # Never echo access_token / webhook_secret. The whole point is
                # that the merchant never has to see or handle them.
                "shop_domain": pending.shop_domain,
                "shop_name": pending.shop_name,
                "currency": pending.currency,
                "installed_at": pending.installed_at,
                "installed_by_email": pending.installed_by_email,
                "scope_count": len([s for s in pending.scopes.split(",") if s.strip()]),
            }
        )

    def post(self, request):
        pending = self._pending_for_org(request)
        if not pending:
            return Response(
                {"detail": "No Shopify app install is waiting for this organization."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if not (pending.access_token and pending.webhook_secret):
            return Response(
                {
                    "detail": "The stored credentials are incomplete - reinstall the "
                    "FynkTech AI app on your Shopify store."
                },
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        # A store domain is globally unique across the whole OMS
        # (ShopifyConnection.shop_domain is unique), so refuse early with a
        # readable error rather than an IntegrityError from update_or_create.
        clash = (
            ShopifyConnection.objects.all_objects.filter(shop_domain=pending.shop_domain)
            .exclude(organization_id=request.organization_id)
            .exists()
        )
        if clash:
            return Response(
                {"detail": "This Shopify store is already connected to another organization."},
                status=http_status.HTTP_409_CONFLICT,
            )

        try:
            shop_info = shopify_client.fetch_shop_info(
                pending.shop_domain, pending.access_token, settings.SHOPIFY_API_VERSION
            )
        except shopify_client.ShopifyAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)

        webhook_url = f"{settings.PUBLIC_BACKEND_URL.rstrip('/')}{reverse('shopify-order-webhook')}"
        webhook_ids = []
        warnings = []
        for topic in ("orders/create", "orders/updated"):
            try:
                webhook = shopify_client.register_webhook(
                    pending.shop_domain,
                    pending.access_token,
                    settings.SHOPIFY_API_VERSION,
                    topic,
                    webhook_url,
                )
                webhook_ids.append(webhook["id"])
            except shopify_client.ShopifyAPIError as exc:
                warnings.append(str(exc))

        connection, _ = ShopifyConnection.objects.update_or_create(
            organization_id=request.organization_id,
            defaults={
                "shop_domain": pending.shop_domain,
                "shop_name": shop_info.get("name", ""),
                "access_token": pending.access_token,
                "webhook_secret": pending.webhook_secret,
                "currency": shop_info.get("currency", ""),
                "is_connected": True,
                "webhooks_active": bool(webhook_ids) and not warnings,
                "webhook_ids": webhook_ids,
            },
        )

        pending.status = "connected"
        pending.save(update_fields=["status", "updated_at"])

        data = ShopifyConnectionSerializer(connection).data
        data["connected"] = True
        data["webhook_url"] = webhook_url
        if warnings:
            data["webhook_warnings"] = warnings
        return Response(data, status=http_status.HTTP_201_CREATED)
