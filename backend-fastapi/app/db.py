import json
import ssl

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


def _ssl_context() -> ssl.SSLContext:
    # Matches ../frontend/app/oms.server.js: Supabase's pooler terminates TLS
    # with a chain the default verifier won't chase, so we trust the pooler
    # hostname in DATABASE_URL instead of verifying the certificate.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def _init_connection(conn: asyncpg.Connection) -> None:
    # asyncpg leaves json/jsonb as raw text by default; decode/encode through
    # the stdlib json module so callers can pass/receive plain Python values
    # (webhook_ids, allowed_modules, etc.) instead of hand-rolling strings.
    for typename in ("json", "jsonb"):
        await conn.set_type_codec(
            typename, encoder=json.dumps, decoder=json.loads, schema="pg_catalog", format="text"
        )


async def connect_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=1,
            max_size=5,
            ssl=_ssl_context(),
            init=_init_connection,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised - call connect_pool() at startup")
    return _pool
