from datetime import datetime

from pydantic import BaseModel


class PendingStatus(BaseModel):
    pending: bool
    shop_domain: str | None = None
    shop_name: str | None = None
    currency: str | None = None
    installed_at: datetime | None = None
    installed_by_email: str | None = None
    scope_count: int | None = None


class ConnectResult(BaseModel):
    id: int
    organization_id: str
    shop_domain: str
    shop_name: str
    currency: str
    is_connected: bool
    webhooks_active: bool
    webhook_ids: list[str]
    auto_sync_orders: bool
    created_at: datetime
    updated_at: datetime
    connected: bool = True
    webhook_url: str
    webhook_warnings: list[str] = []
