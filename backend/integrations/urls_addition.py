"""Add this one line to the urlpatterns in backend/integrations/urls.py,
directly under the existing "shopify/test/" entry.

    path(
        "shopify/pending/",
        views.ShopifyPendingInstallView.as_view(),
        name="shopify-pending-install",
    ),

Full file for reference:
"""

from django.urls import path

from . import views

urlpatterns = [
    path("shopify/", views.ShopifyConnectionView.as_view(), name="shopify-connection"),
    path("shopify/test/", views.ShopifyTestConnectionView.as_view(), name="shopify-test-connection"),
    # NEW
    path(
        "shopify/pending/",
        views.ShopifyPendingInstallView.as_view(),
        name="shopify-pending-install",
    ),
    path("shopify/sync/", views.ShopifySyncView.as_view(), name="shopify-sync"),
    path("shopify/gaps/", views.ShopifyGapView.as_view(), name="shopify-gaps"),
    path("webhooks/shopify/orders/", views.shopify_order_webhook, name="shopify-order-webhook"),
    path("smartlane/", views.SmartlaneConnectionView.as_view(), name="smartlane-connection"),
    path(
        "smartlane/webhook/<uuid:token>/",
        views.smartlane_shipment_webhook,
        name="smartlane-shipment-webhook",
    ),
]
