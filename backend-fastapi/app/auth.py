from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException, status

from .config import settings
from .db import get_pool


@dataclass
class AuthContext:
    user_id: str
    organization_id: str | None
    is_super_admin: bool


def _claim(payload: dict, key: str) -> str | None:
    # Mirrors core.jwt_claim() in Postgres: app_metadata wins, user_metadata
    # is the fallback. app_metadata is the one only the server can write, so
    # that's where organization_id/role are expected to live.
    app_meta = payload.get("app_metadata") or {}
    user_meta = payload.get("user_metadata") or {}
    return app_meta.get(key) or user_meta.get(key)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        ) from exc


async def require_org(authorization: str = Header(default="")) -> AuthContext:
    """Resolve the caller's organization the same way Postgres RLS does for
    this project (core.current_organization_id / core.is_super_admin), then
    cross-check it against core.memberships.

    The pooled Postgres role this service connects with has BYPASSRLS, so
    unlike PostgREST-fronted access, RLS itself enforces nothing here - every
    query in this service must filter by organization_id explicitly. This
    dependency is what supplies that organization_id, verified.
    """
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization[len("bearer "):].strip()

    payload = _decode(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has no subject")

    organization_id = _claim(payload, "organization_id")
    is_super_admin = _claim(payload, "role") == "super_admin"

    if not organization_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token has no organization_id claim",
        )

    if not is_super_admin:
        pool = get_pool()
        member = await pool.fetchval(
            "select 1 from core.memberships where user_id = $1 and organization_id = $2",
            user_id,
            organization_id,
        )
        if not member:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not a member of the organization named in the token",
            )

    return AuthContext(user_id=user_id, organization_id=organization_id, is_super_admin=is_super_admin)
