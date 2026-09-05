// This app has no UI - it's a pure OAuth relay. Anyone hitting the bare
// app URL (instead of the OMS's Connect Shopify button, which always links
// straight to /auth?shop=...) gets redirected straight to the OMS.
export async function loader() {
  const omsAppUrl = (process.env.OMS_APP_URL || "/").replace(/\/$/, "") || "/";
  return new Response(null, { status: 302, headers: { Location: omsAppUrl } });
}
