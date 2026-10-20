import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { isOmsConfigured, stageInstall } from "./oms.server";

const API_VERSION = ApiVersion.July26;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: API_VERSION,
  scopes: process.env.SCOPES?.split(",").map((s) => s.trim()).filter(Boolean),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    // ON. Shopify requires expiring offline tokens for public apps as of
    // April 1 2026 (already past) - permanent tokens are deprecated and
    // Shopify's own Monitoring dashboard flags their continued use. The
    // refresh_token this produces is captured in afterAuth below and staged
    // alongside the access_token so backend-fastapi can refresh it
    // independently - see backend-fastapi/app/shopify_client.py::
    // refresh_access_token and backend-fastapi/scripts/refresh_tokens.py,
    // which already exist for exactly this.
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    /**
     * Runs once per successful OAuth exchange - the merchant has just granted
     * every scope in shopify.app.toml and we are holding the offline Admin API
     * token. This is the whole point of the app: capture the three values the
     * OMS asks for and stage them for the merchant's organization.
     *
     * This is a fallback only - the primary org-resolution path is
     * backend-fastapi's POST /start pre-assigning the organization before
     * the merchant ever leaves the OMS (see ../backend-fastapi/app/routers/
     * pending.py::start_install). savePendingInstall's `on conflict` keeps
     * that existing organization_id, so the email-matching below only
     * matters if someone installs without going through the OMS's Connect
     * Shopify button.
     *
     * Never throws. A failure to reach the OMS must not break the install -
     * the app page surfaces the error and offers a retry instead.
     */
    afterAuth: async ({ session, admin }) => {
      try {
        // shopify.app.toml also declares these same topics declaratively
        // (synced to Shopify on every `deploy`), so this call can now hit a
        // duplicate-registration conflict where it previously didn't - never
        // let that crash the whole auth flow.
        await shopify.registerWebhooks({ session });
      } catch (err) {
        console.error(`[oms] registerWebhooks failed for ${session.shop}:`, err.message);
      }

      if (!isOmsConfigured()) {
        console.warn("[oms] OMS_DATABASE_URL unset - install not staged for", session.shop);
        return;
      }

      // Best-effort here: the /app page loader (routes/app._index.jsx)
      // stages the install itself if this did not, so a failure is recovered
      // on the very next render rather than needing a reinstall.
      try {
        await stageInstall({ session, admin, apiVersion: API_VERSION });
      } catch (err) {
        console.error(
          `[oms] failed to stage install for ${session.shop}:`,
          err?.message ?? `HTTP ${err?.status}`,
        );
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
