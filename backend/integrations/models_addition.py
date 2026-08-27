"""APPEND this class to backend/integrations/models.py.

Deliberately a plain models.Model, not a TenantScopedModel: `organization` has
to be nullable here. An install whose owner we could not identify must belong to
nobody until it is claimed, and TenantScopedModel's FK is non-null by design.

The trade-off is that TenantManager does not scope reads for you, so every
queryset below MUST filter organization_id explicitly. The view in
views_addition.py does; anything you add later must too.
"""

import uuid

from django.db import models


class ShopifyPendingInstall(models.Model):
    """Credentials captured by the FynkTech AI Shopify app at install time,
    waiting for someone in the owning organization to press "Connect".

    Written by the Shopify app over direct SQL (see fynk-tech-ai/app/oms.server.js),
    read here. Nothing in this table is live: promoting a row into a real
    ShopifyConnection - verifying the token, registering webhooks - stays the
    OMS's job, and only happens on an authenticated request from a user in the
    matching organization.

    access_token / webhook_secret are plaintext, matching the same caveat on
    ShopifyConnection. If you add field-level encryption there, add it here in
    the same change.
    """

    MATCH_METHOD_CHOICES = [
        ("email", "Matched on store owner email"),
        ("claimed", "Claimed by merchant in the Shopify app"),
        ("unassigned", "Unassigned"),
    ]
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("connected", "Connected"),
        ("uninstalled", "Uninstalled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop_domain = models.TextField(unique=True)
    shop_name = models.TextField(blank=True, default="")
    currency = models.TextField(blank=True, default="")
    access_token = models.TextField(blank=True, default="")
    # The Shopify app's own shpss_ shared secret - Shopify signs webhook bodies
    # with it, so it is exactly what ShopifyConnection.webhook_secret needs.
    webhook_secret = models.TextField(blank=True, default="")
    scopes = models.TextField(blank=True, default="")
    api_version = models.TextField(blank=True, default="")
    installed_by_email = models.TextField(blank=True, default="")

    organization = models.ForeignKey(
        "core.Organization",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    match_method = models.TextField(choices=MATCH_METHOD_CHOICES, default="unassigned")
    status = models.TextField(choices=STATUS_CHOICES, default="pending")
    # Shown in the embedded Shopify app so support can identify an install over
    # chat without the merchant reading out an access token.
    claim_code = models.TextField(blank=True, default="")

    installed_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    uninstalled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = '"integrations"."shopify_pending_installs"'
        ordering = ["-installed_at"]
        indexes = [
            models.Index(fields=["organization", "status"], name="shopify_pending_org_status_idx")
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(match_method__in=["email", "claimed", "unassigned"]),
                name="shopify_pending_installs_match_method_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=["pending", "connected", "uninstalled"]),
                name="shopify_pending_installs_status_valid",
            ),
        ]

    def __str__(self):
        return f"{self.shop_domain} ({self.status})"
