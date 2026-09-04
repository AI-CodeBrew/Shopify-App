import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

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
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

// Non-embedded install/token capture is hand-rolled classic OAuth
// (routes/auth.jsx, routes/auth.callback.jsx) - authenticate.admin only
// implements the embedded token-exchange strategy, so it's unused here.
// This instance now exists only for `authenticate.webhook`, which the
// webhook routes still use to verify Shopify's HMAC signature.
export default shopify;
export const authenticate = shopify.authenticate;
// entry.server.jsx calls this on every response (sets the CSP headers
// Shopify requires) - still needed even though authenticate.admin itself
// is unused now.
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
