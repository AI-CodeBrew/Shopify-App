/**
 * Non-embedded Shopify auth for the Connector app.
 *
 * @shopify/shopify-app-react-router only supports embedded token-exchange for
 * App Store apps (it always forces Admin iframe). This module uses
 * @shopify/shopify-api authorization-code OAuth + offline sessions instead,
 * while still using the React Router package for webhook verification.
 */
import "@shopify/shopify-api/adapters/web-api";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";
import {
  ApiVersion as ReactRouterApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { redirect } from "react-router";
import prisma from "./db.server";
import { isOmsConfigured, stageInstall } from "./oms.server";

const API_VERSION = ApiVersion.July26;
// Same calendar version string the React Router package expects.
const RR_API_VERSION = ReactRouterApiVersion.July26;

function appHost() {
  const raw = process.env.SHOPIFY_APP_URL || "";
  try {
    return new URL(raw);
  } catch {
    return new URL("https://connector.fynktech.com");
  }
}

const host = appHost();
const scopes = (process.env.SCOPES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const sessionStorage = new PrismaSessionStorage(prisma);

export const api = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  scopes,
  hostName: host.host,
  hostScheme: host.protocol.replace(":", ""),
  apiVersion: API_VERSION,
  isEmbeddedApp: false,
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

// Webhook HMAC verification only (does not drive page auth).
const webhookApp = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: RR_API_VERSION,
  scopes,
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage,
  distribution: AppDistribution.AppStore,
});

function createAdmin(session) {
  const client = new api.clients.Graphql({ session });
  return {
    graphql: async (query, options = {}) => {
      const result = await client.request(query, options);
      return {
        ok: true,
        json: async () => result,
      };
    },
  };
}

/**
 * Start authorization-code OAuth for a shop (non-embedded).
 * @returns {Promise<Response>}
 */
export async function beginAuth(request, shop) {
  const sanitized = api.utils.sanitizeShop(shop, true);
  if (!sanitized) {
    throw new Response("Invalid shop", { status: 400 });
  }
  return api.auth.begin({
    shop: sanitized,
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: request,
  });
}

/**
 * Complete OAuth callback, persist session, stage OMS install, redirect to /app.
 */
export async function completeAuthCallback(request) {
  const callback = await api.auth.callback({
    rawRequest: request,
    expiring: true,
  });
  const { session, headers } = callback;
  await sessionStorage.storeSession(session);

  const admin = createAdmin(session);
  try {
    await webhookApp.registerWebhooks({ session });
  } catch (err) {
    console.error(`[oms] registerWebhooks failed for ${session.shop}:`, err.message);
  }

  if (isOmsConfigured()) {
    try {
      await stageInstall({ session, admin, apiVersion: API_VERSION });
    } catch (err) {
      console.error(
        `[oms] failed to stage install for ${session.shop}:`,
        err?.message ?? `HTTP ${err?.status}`,
      );
    }
  }

  throw redirect(`/app?shop=${encodeURIComponent(session.shop)}`, { headers });
}

/**
 * Cookie / offline-session auth for standalone (non-embedded) pages.
 * Matches the `{ session, admin }` shape used by our loaders.
 */
async function authenticateAdmin(request) {
  const url = new URL(request.url);
  let shop = url.searchParams.get("shop");
  if (shop) {
    shop = api.utils.sanitizeShop(shop, true);
  }

  let sessionId = shop ? api.session.getOfflineId(shop) : undefined;
  if (!sessionId) {
    sessionId = await api.session.getCurrentId({
      isOnline: false,
      rawRequest: request,
    });
  }

  let session = sessionId ? await sessionStorage.loadSession(sessionId) : undefined;

  if (!shop && session?.shop) shop = session.shop;

  // No session, or uninstall left a row without a token → full OAuth again.
  if (!session?.accessToken) {
    if (!shop) {
      throw new Response("Missing shop parameter", { status: 400 });
    }
    if (session?.id) {
      try {
        await sessionStorage.deleteSession(session.id);
      } catch {
        /* ignore */
      }
    }
    throw await beginAuth(request, shop);
  }

  // Ensure shop query stays on subsequent navigations inside /app/*
  if (shop && session.shop !== shop) {
    throw await beginAuth(request, shop);
  }

  return {
    session,
    admin: createAdmin(session),
  };
}

/** True when Shopify rejected the offline token (e.g. after uninstall). */
export function isShopifyUnauthorizedError(err) {
  const msg = String(err?.message || err || "");
  return (
    msg.includes("401") ||
    /unauthorized/i.test(msg) ||
    /invalid api key or access token/i.test(msg)
  );
}

/**
 * Drop the stored offline session and restart OAuth so a revoked token
 * (common after uninstall when the webhook didn't clear Prisma) cannot be reused.
 */
export async function forceReauth(request, shop, session) {
  if (session?.id) {
    try {
      await sessionStorage.deleteSession(session.id);
    } catch {
      /* ignore */
    }
  }
  const sanitized = api.utils.sanitizeShop(shop || session?.shop, true);
  if (!sanitized) {
    throw new Response("Missing shop parameter", { status: 400 });
  }
  throw await beginAuth(request, sanitized);
}

export const authenticate = {
  admin: authenticateAdmin,
  webhook: webhookApp.authenticate.webhook,
};

export const apiVersion = API_VERSION;
export const registerWebhooks = webhookApp.registerWebhooks;
/** Used by entry.server.jsx — no Admin iframe CSP needed for non-embedded. */
export function addDocumentResponseHeaders(_request, _headers) {
  // Intentionally empty: standalone app is not loaded inside Shopify Admin.
}
export { sessionStorage };
export default {
  authenticate,
  sessionStorage,
  api,
  addDocumentResponseHeaders,
};
