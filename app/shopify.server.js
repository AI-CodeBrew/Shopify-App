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
    // Deliberately OFF. Expiring offline tokens rotate every 24h behind a
    // refresh token that only this app holds. The OMS stores one static
    // `access_token` per store (integrations.ShopifyConnection) and has no
    // refresh path, so every sync would start failing a day after connect.
    // Permanent offline tokens are what the OMS's model actually supports.
    // Turning this on later means teaching the OMS to refresh - see
    // OMS-PATCH.md.
    expiringOfflineAccessTokens: false,
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
