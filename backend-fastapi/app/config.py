from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    supabase_jwt_secret: str
    # Same value as Fynktech-oms/backend/.env.backend's SUPABASE_URL. Only
    # needed for the JWKS endpoint ({supabase_url}/auth/v1/.well-known/jwks.json)
    # that app/auth.py falls back to for non-HS256 (ES256/RS256) tokens.
    supabase_url: str = ""
    # Same client_id/client_secret as ../frontend's SHOPIFY_API_KEY/SECRET -
    # needed for refresh_access_token, which authenticates as the app itself
    # (grant_type=refresh_token), not on behalf of any one merchant.
    shopify_api_key: str = ""
    shopify_api_secret: str = ""
    shopify_api_version: str = "2026-10"
    public_backend_url: str = "http://localhost:8000"
    # ../frontend's SHOPIFY_APP_URL - where /start sends the OMS to begin
    # installing the app (GET {shopify_app_url}/auth?shop=...).
    shopify_app_url: str = ""
    cors_origins: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
