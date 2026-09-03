import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import {
  findOrganizationByEmail,
  isOmsConfigured,
  savePendingInstall,
} from "./oms.server";

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
    // ON. Shopify requires expiring offline tokens for new public apps as of
    // April 1 2026 (all public apps by January 1 2027). The refresh_token
    // this produces is captured in afterAuth below and staged alongside the
    // access_token so backend-fastapi can refresh it independently - see
    // backend-fastapi/app/shopify_client.py::refresh_access_token and
    // backend-fastapi/scripts/refresh_tokens.py.
    //
    // Note: this app's own session (Prisma, below) also auto-refreshes on
    // every embedded page load via the library's built-in
    // ensureOfflineTokenIsNotExpired. That's a SEPARATE refresh cycle from
    // backend-fastapi's - Shopify's docs warn that acquiring/refreshing a
    // token from two places can retire the other's copy. backend-fastapi is
    // the intended source of truth for ongoing access; if this app's own
    // refresh ever invalidates backend-fastapi's stored refresh_token,
    // backend-fastapi detects the failure and flags the connection instead
    // of failing silently (see refresh_access_token's caller).
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    /**
     * Runs once per successful OAuth exchange - the merchant has just granted
     * every scope in shopify.app.toml and we are holding the offline Admin API
     * token. This is the whole point of the app: capture the three values the
     * OMS asks for and stage them for the merchant's organization.
     *
     * Never throws. A failure to reach the OMS must not break the install -
     * the embedded app surfaces the error and offers a retry instead.
     */
    afterAuth: async ({ session, admin }) => {
      // Earliest point our own code sees the token - the raw HTTP exchange
      // itself happens inside @shopify/shopify-api's token-exchange.js,
      // which we don't control. Redacted (presence/length only, not the
      // actual secret) per this project's "don't log real credentials" rule.
      console.log("[oms] afterAuth session token shapes", {
        shop: session.shop,
        isOnline: session.isOnline,
        accessToken: session.accessToken ? `present, len=${session.accessToken.length}` : "MISSING",
        refreshToken: session.refreshToken ? `present, len=${session.refreshToken.length}` : "absent",
        expires: session.expires ?? null,
        refreshTokenExpires: session.refreshTokenExpires ?? null,
      });

      await shopify.registerWebhooks({ session });

      if (!isOmsConfigured()) {
        console.warn("[oms] OMS_DATABASE_URL unset - install not staged for", session.shop);
        return;
      }

      try {
        const response = await admin.graphql(
          `#graphql
            query FynkTechShopIdentity {
              shop {
                name
                email
                myshopifyDomain
                currencyCode
              }
            }`,
        );
        const body = await response.json();
        const shop = body?.data?.shop ?? {};

        // The store owner's account email. Matching it against Supabase
        // auth.users is the only signal we have at install time for *which*
        // OMS tenant this store belongs to.
        const email = shop.email || "";
        const match = email ? await findOrganizationByEmail(email) : null;

        await savePendingInstall({
          shopDomain: shop.myshopifyDomain || session.shop,
          shopName: shop.name || "",
          currency: shop.currencyCode || "",
          accessToken: session.accessToken,
          // Present because expiringOfflineAccessTokens is on above. Absent
          // (undefined) session.expires/refreshToken/refreshTokenExpires would
          // mean Shopify handed back a non-expiring token instead - shouldn't
          // happen with the flag on, but savePendingInstall defaults handle it.
          refreshToken: session.refreshToken || "",
          accessTokenExpiresAt: session.expires ?? null,
          refreshTokenExpiresAt: session.refreshTokenExpires ?? null,
          // What the OMS stores as `webhook_secret`: Shopify signs webhook
          // payloads with the app's shared secret, so this app's own secret is
          // exactly the key the OMS needs to verify them.
          webhookSecret: process.env.SHOPIFY_API_SECRET || "",
          scopes: session.scope || "",
          apiVersion: API_VERSION,
          installedByEmail: email,
          organizationId: match?.organizationId ?? null,
          matchMethod: match ? "email" : "unassigned",
        });

        console.log(
          `[oms] staged install for ${session.shop}`,
          match ? `-> org ${match.organizationName}` : "-> unassigned (awaiting claim)",
        );
      } catch (err) {
        console.error(`[oms] failed to stage install for ${session.shop}:`, err.message);
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
