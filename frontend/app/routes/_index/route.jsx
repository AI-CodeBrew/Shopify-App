import { redirect } from "react-router";

// Shopify lands here with ?shop=... when opening the embedded app from
// admin - hand off to /app, which runs authenticate.admin and shows the
// connection status page. Anyone else hitting the bare app URL directly
// (not via Shopify or the OMS's Connect Shopify button) just gets sent to
// the OMS instead of an empty page.
export async function loader({ request }) {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const omsAppUrl = (process.env.OMS_APP_URL || "/").replace(/\/$/, "") || "/";
  return new Response(null, { status: 302, headers: { Location: omsAppUrl } });
}
