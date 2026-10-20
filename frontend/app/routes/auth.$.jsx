import { beginAuth } from "../shopify.server";

/**
 * Non-embedded auth entry (`/auth?shop=...` or `/auth/login?shop=...`).
 * Starts the authorization-code grant instead of embedded token exchange.
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    throw new Response("Missing shop", { status: 400 });
  }
  return beginAuth(request, shop);
};
