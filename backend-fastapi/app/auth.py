import ssl
from dataclasses import dataclass

import certifi
import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient

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


_jwk_client: PyJWKClient | None = None


def _get_jwk_client() -> PyJWKClient:
    # Mirrors ../../Fynktech-oms/backend/core/jwt_utils.py exactly - same
    # reasoning applies here: newer Supabase projects sign JWTs
    # asymmetrically (ES256/RS256) and publish a JWKS endpoint instead of a
    # shared secret. Cached in-process; certifi's CA bundle avoids the
    # platform SSL verify issues plain urllib sometimes hits on JWKS fetch.
    global _jwk_client
    if _jwk_client is None:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        _jwk_client = PyJWKClient(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
            ssl_context=ssl_context,
        )
    return _jwk_client


def _decode(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        ) from exc

    try:
        if header.get("alg") == "HS256":
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
        signing_key = _get_jwk_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=[header["alg"]],
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
