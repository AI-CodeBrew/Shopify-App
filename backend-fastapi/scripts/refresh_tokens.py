"""Manual/on-demand entry point for the Shopify token refresh cycle.

The connector now also runs this automatically in-process every 30 minutes
(see app/main.py's lifespan + app/token_refresh.py) - this script is kept
for a manual run when you want one right now:

    python scripts/refresh_tokens.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import close_pool, connect_pool, get_pool  # noqa: E402
from app.token_refresh import refresh_due_connections  # noqa: E402


async def main() -> None:
    await connect_pool()
    try:
        await refresh_due_connections(get_pool())
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
