import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isOmsConfigured, purgeShop } from "../oms.server";

/**
 * Shopify's three mandatory privacy webhooks. Required for App Store
 * distribution and verified during review - the listing is rejected without
 * them, and Shopify sends signed test payloads to this URL.
 *
 * This app deliberately stores no buyer data: the only thing it persists is a
 * store's Admin API credentials plus the installing staff member's email. So
 * the two customer topics have nothing to erase or disclose, and only
 * shop/redact does real work.
 */
export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // No buyer records held. Nothing to hand back to the merchant.
      console.log(
        `[compliance] customers/data_request for ${shop} (customer ` +
          `${payload?.customer?.id}) - no customer data stored by this app`,
      );
      break;

    case "CUSTOMERS_REDACT":
      console.log(
        `[compliance] customers/redact for ${shop} (customer ` +
          `${payload?.customer?.id}) - no customer data stored by this app`,
      );
      break;

    case "SHOP_REDACT":
      // Fires 48h after uninstall. Everything tied to this shop goes.
      await db.session.deleteMany({ where: { shop } });
      if (isOmsConfigured()) {
        try {
          await purgeShop(shop);
        } catch (err) {
          // Surface as a 500 so Shopify retries - unlike the uninstall hook,
          // silently dropping this one leaves us out of compliance.
          console.error(`[compliance] shop/redact failed for ${shop}:`, err.message);
          throw err;
        }
      }
      console.log(`[compliance] shop/redact complete for ${shop}`);
      break;

    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response();
};
