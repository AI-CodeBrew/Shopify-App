import crypto from "node:crypto";

/**
 * Begin classic OAuth (GET /auth?shop=xxx.myshopify.com).
 *
 * This app is non-embedded, so it can't use @shopify/shopify-app-react-router's
 * authenticate.admin (that strategy only implements embedded token-exchange -
 * see app/shopify.server.js). Classic OAuth needs no SDK: just a redirect to
 * Shopify's authorize screen with a CSRF nonce, and a matching /auth/callback
 * to trade the returned code for a token.
 *
 * The OMS's "Connect Shopify" button links straight here after reserving the
 * shop for the merchant's organization via backend-fastapi's POST /start -
 * see auth.callback.jsx for the other half of that handoff.
 */
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") || "").trim().toLowerCase();

  if (!SHOP_DOMAIN_RE.test(shop)) {
    return new Response("Missing or invalid shop parameter.", { status: 400 });
  }

  const scopes = (process.env.SCOPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const redirectUri = `${appUrl}/auth/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", process.env.SHOPIFY_API_KEY || "");
  authorizeUrl.searchParams.set("scope", scopes);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  const headers = new Headers({ Location: authorizeUrl.toString() });
  // HttpOnly + short-lived: only used to check the state round-trips through
  // Shopify's consent screen unmodified, not for anything session-related.
  headers.append(
    "Set-Cookie",
    `shopify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  return new Response(null, { status: 302, headers });
}
