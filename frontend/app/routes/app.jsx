import { Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  // Standalone browser tab — not inside Shopify Admin.
  return (
    <AppProvider embedded={false} apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    error?.data || error?.message || (typeof error === "string" ? error : "Something went wrong.");
  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 560 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Application Error</h1>
      <p style={{ color: "#6d1d1d", background: "#fcebeb", padding: 12, borderRadius: 8 }}>
        {String(message)}
      </p>
    </div>
  );
}
