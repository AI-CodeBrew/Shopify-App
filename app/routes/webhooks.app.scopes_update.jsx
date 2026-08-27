import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isOmsConfigured, updateStoredScopes } from "../oms.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;

  if (session) {
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });
  }

  // Keep the staged row honest so the OMS can tell a merchant that a scope it
  // needs was revoked, instead of failing opaquely on the next sync.
  if (isOmsConfigured()) {
    try {
      await updateStoredScopes(shop, current.toString());
    } catch (err) {
      console.error(`[oms] could not update scopes for ${shop}:`, err.message);
    }
  }

  return new Response();
};
