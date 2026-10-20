import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isOmsConfigured, markUninstalled } from "../oms.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Always wipe sessions for this shop. Do not gate on whether Shopify still
  // returns a loadable session — after uninstall the webhook often has none,
  // and skipping delete left a revoked token in Prisma that "reinstall"
  // reused without OAuth → OMS finalize 401.
  await db.session.deleteMany({ where: { shop } });

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
