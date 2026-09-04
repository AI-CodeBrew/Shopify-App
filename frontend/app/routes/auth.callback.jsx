import crypto from "node:crypto";
import { isOmsConfigured, savePendingInstall } from "../oms.server";

/**
 * Finish classic OAuth (GET /auth/callback). Verifies Shopify's HMAC and our
 * own CSRF state cookie (set in auth.jsx), trades the code for an offline
 * access token via a plain POST (no SDK - see auth.jsx for why), stores it,
 * and sends the merchant straight back to the OMS. No UI is ever rendered in
 * between - this app is a stateless relay from here on.
 *
 * The organization this install belongs to isn't resolved here: the OMS
 * pre-assigns it via backend-fastapi's POST /start before redirecting the
 * merchant to auth.jsx, and savePendingInstall's `on conflict` keeps that
 * existing organization_id (see its own docstring). This route only ever
 * writes organizationId: null, matchMethod: "unassigned" - a no-op unless
 * the app was installed without going through the OMS's Connect button, in
 * which case the install is staged unassigned rather than misattributed.
 */
function readCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function verifyHmac(searchParams, secret) {
  const hmac = searchParams.get("hmac");
  if (!hmac || !secret) return false;

  const params = new URLSearchParams(searchParams);
  params.delete("hmac");
  params.delete("signature");
  const message = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const digestBuf = Buffer.from(digest, "utf8");
  const hmacBuf = Buffer.from(hmac, "utf8");
  return digestBuf.length === hmacBuf.length && crypto.timingSafeEqual(digestBuf, hmacBuf);
}

function omsRedirect(path) {
  const omsAppUrl = (process.env.OMS_APP_URL || "").replace(/\/$/, "");
  const headers = new Headers({ Location: `${omsAppUrl}${path}` });
  headers.append("Set-Cookie", "shopify_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return new Response(null, { status: 302, headers });
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") || "").trim().toLowerCase();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const cookieState = readCookie(request, "shopify_oauth_state");

  if (!shop || !code || !state || state !== cookieState || !verifyHmac(url.searchParams, secret)) {
    console.error("[oauth] callback failed verification for", shop);
    return omsRedirect("/integrations/shopify?shopify_error=invalid_request");
  }

  let token;
  try {
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: secret,
        code,
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`Shopify returned ${tokenResponse.status}`);
    }
    token = await tokenResponse.json();
  } catch (err) {
    console.error(`[oauth] token exchange failed for ${shop}:`, err.message);
    return omsRedirect("/integrations/shopify?shopify_error=token_exchange_failed");
  }

  if (isOmsConfigured()) {
    try {
      await savePendingInstall({
        shopDomain: shop,
        accessToken: token.access_token,
        refreshToken: token.refresh_token || "",
        accessTokenExpiresAt: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000).toISOString()
          : null,
        refreshTokenExpiresAt: token.refresh_token_expires_in
          ? new Date(Date.now() + token.refresh_token_expires_in * 1000).toISOString()
          : null,
        // Shopify signs every webhook with the app's own shared secret -
        // same value for every shop, not something the OAuth exchange hands
        // back per-store.
        webhookSecret: secret,
        scopes: token.scope || "",
        apiVersion: process.env.SHOPIFY_API_VERSION || "",
        organizationId: null,
        matchMethod: "unassigned",
      });
    } catch (err) {
      console.error(`[oms] failed to stage install for ${shop}:`, err.message);
      return omsRedirect("/integrations/shopify?shopify_error=save_failed");
    }
  } else {
    console.error("[oms] OMS_DATABASE_URL unset - install not staged for", shop);
    return omsRedirect("/integrations/shopify?shopify_error=oms_not_configured");
  }

  return omsRedirect("/integrations/shopify?connected=1");
}
