from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import close_pool, connect_pool, get_pool
from .routers import pending, webhooks


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_pool()
    yield
    await close_pool()


app = FastAPI(title="FynkTech AI - OMS connector (FastAPI)", lifespan=lifespan)

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(pending.router)
app.include_router(webhooks.router)


@app.get("/health")
async def health():
    pool = get_pool()
    checks = {}
    try:
        row = await pool.fetchrow(
            """
            select to_regclass('core.organizations')                      as orgs,
                   to_regclass('integrations.shopify_pending_installs')    as pending,
                   to_regclass('integrations.shopify_connections')         as connections
            """
        )
        checks["database"] = "ok"
        checks["core.organizations"] = bool(row["orgs"])
        checks["integrations.shopify_pending_installs"] = bool(row["pending"])
        checks["integrations.shopify_connections"] = bool(row["connections"])
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller, not swallowed
        checks["database"] = f"error: {exc}"

    ok = checks.get("database") == "ok" and all(
        checks.get(k) for k in ("integrations.shopify_pending_installs", "integrations.shopify_connections")
    )
    return {"ok": ok, "checks": checks}
