import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import close_pool, connect_pool, get_pool
from .routers import pending, webhooks
from .token_refresh import REFRESH_INTERVAL_SECONDS, refresh_due_connections

logger = logging.getLogger("uvicorn.error")


async def _refresh_loop() -> None:
    """Runs immediately on startup, then every REFRESH_INTERVAL_SECONDS.

    Single machine, single uvicorn worker (see Dockerfile) - this task runs
    exactly once, no external cron/scheduler needed.
    """
    while True:
        try:
            await refresh_due_connections(get_pool())
        except Exception:  # noqa: BLE001 - a bad cycle must not kill the loop
            logger.exception("[refresh] background refresh cycle failed")
        await asyncio.sleep(REFRESH_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_pool()
    refresh_task = asyncio.create_task(_refresh_loop())
    yield
    refresh_task.cancel()
    await close_pool()


app = FastAPI(title="FynkTech AI - OMS connector (FastAPI)", lifespan=lifespan)


# Registered before CORSMiddleware on purpose, so it sits inside it. An
# unhandled exception otherwise becomes Starlette's bare 500, produced outside
# CORSMiddleware and so without CORS headers - the OMS's browser then reports
# an opaque "Failed to fetch" instead of an error the page can show.
@app.middleware("http")
async def _unhandled_errors_as_json(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:  # noqa: BLE001 - logged in full, reported generically
        logger.exception("[error] unhandled exception on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "The Shopify connector hit an unexpected error. Please try again."},
        )


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
