import { completeAuthCallback } from "../shopify.server";

/**
 * Non-embedded OAuth callback — Shopify redirects here after the merchant
 * approves scopes. Stores the offline session and sends them to /app.
 */
export const loader = async ({ request }) => {
  return completeAuthCallback(request);
};
