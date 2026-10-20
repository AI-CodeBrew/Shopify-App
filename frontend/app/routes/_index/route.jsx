import { redirect } from "react-router";

// Non-embedded entry:
// - Install / Connect links land here with ?shop=... → /app
//   (authorization-code OAuth runs if needed, then connection status).
// - Anyone else hitting the bare app URL is sent to the OMS home.
export async function loader({ request }) {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const omsAppUrl = (process.env.OMS_APP_URL || "/").replace(/\/$/, "") || "/";
  return new Response(null, { status: 302, headers: { Location: omsAppUrl } });
}
