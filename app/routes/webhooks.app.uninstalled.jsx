import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isOmsConfigured, markUninstalled } from "../oms.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Tell the OMS the token it holds is dead. Best-effort: Shopify retries this
  // webhook, and throwing here would only turn a stale row into a failed
  // delivery on top of it.
  if (isOmsConfigured()) {
    try {
      await markUninstalled(shop);
    } catch (err) {
      console.error(`[oms] could not mark ${shop} uninstalled:`, err.message);
    }
  }

  return new Response();
};
