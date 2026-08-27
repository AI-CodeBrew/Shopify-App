"""Staging table for Shopify app installs.

Copy to backend/integrations/migrations/0010_shopifypendinginstall.py.

Follows the same shape as 0001_initial: CreateModel, then RunSQL to attach the
shared tenant-isolation policy from core.rls.
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models

from core.rls import organization_scoped_policy_sql

ENABLE_RLS = organization_scoped_policy_sql("integrations", "shopify_pending_installs")
DISABLE_RLS = """
    drop policy if exists shopify_pending_installs_tenant_isolation
        on "integrations"."shopify_pending_installs";
    alter table "integrations"."shopify_pending_installs" disable row level security;
"""

# The Shopify app INSERTs into this table over plain SQL, without Django in the
# loop, so it cannot rely on auto_now_add / default=uuid4 - those are applied by
# Django in Python, never by Postgres. Without real column defaults every insert
# from the app would fail on a NOT NULL violation.
ADD_DB_DEFAULTS = """
    alter table "integrations"."shopify_pending_installs"
        alter column id set default gen_random_uuid(),
        alter column installed_at set default now(),
        alter column updated_at set default now();
"""
DROP_DB_DEFAULTS = """
    alter table "integrations"."shopify_pending_installs"
        alter column id drop default,
        alter column installed_at drop default,
        alter column updated_at drop default;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0001_initial"),
        ("integrations", "0009_shopifysyncjob_ranges_alter_shopifysyncjob_mode"),
    ]

    operations = [
        migrations.CreateModel(
            name="ShopifyPendingInstall",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("shop_domain", models.TextField(unique=True)),
                ("shop_name", models.TextField(blank=True, default="")),
                ("currency", models.TextField(blank=True, default="")),
                ("access_token", models.TextField(blank=True, default="")),
                ("webhook_secret", models.TextField(blank=True, default="")),
                ("scopes", models.TextField(blank=True, default="")),
                ("api_version", models.TextField(blank=True, default="")),
                ("installed_by_email", models.TextField(blank=True, default="")),
                ("match_method", models.TextField(default="unassigned")),
                ("status", models.TextField(default="pending")),
                ("claim_code", models.TextField(blank=True, default="")),
                ("installed_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("uninstalled_at", models.DateTimeField(blank=True, null=True)),
                (
                    "organization",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="core.organization",
                    ),
                ),
            ],
            options={
                "db_table": '"integrations"."shopify_pending_installs"',
                "ordering": ["-installed_at"],
            },
        ),
        migrations.AddIndex(
            model_name="shopifypendinginstall",
            index=models.Index(
                fields=["organization", "status"],
                name="shopify_pending_org_status_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="shopifypendinginstall",
            constraint=models.CheckConstraint(
                condition=models.Q(match_method__in=["email", "claimed", "unassigned"]),
                name="shopify_pending_installs_match_method_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="shopifypendinginstall",
            constraint=models.CheckConstraint(
                condition=models.Q(status__in=["pending", "connected", "uninstalled"]),
                name="shopify_pending_installs_status_valid",
            ),
        ),
        migrations.RunSQL(sql=ADD_DB_DEFAULTS, reverse_sql=DROP_DB_DEFAULTS),
        migrations.RunSQL(sql=ENABLE_RLS, reverse_sql=DISABLE_RLS),
    ]
