import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  claimPendingInstall,
  getPendingInstall,
  isOmsConfigured,
} from "../oms.server";

// eslint-disable-next-line no-undef
const OMS_URL = () => (process.env.OMS_APP_URL || "").replace(/\/+$/, "");

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const omsUrl = OMS_URL();

  if (!isOmsConfigured()) {
    return { shop: session.shop, omsUrl, state: "misconfigured", install: null };
  }

  try {
    const install = await getPendingInstall(session.shop);
    if (!install) {
      // afterAuth staged nothing - almost always a transient DB error during
      // install. Re-running OAuth is the fix, so say so rather than showing an
      // empty page.
      return { shop: session.shop, omsUrl, state: "not_staged", install: null };
    }
    return {
      shop: session.shop,
      omsUrl,
      state: install.organization_id ? "linked" : "unassigned",
      install: {
        shopName: install.shop_name,
        currency: install.currency,
        scopes: install.scopes ? install.scopes.split(",").filter(Boolean) : [],
        organizationName: install.organization_name,
        matchMethod: install.match_method,
        status: install.status,
        installedByEmail: install.installed_by_email,
      },
    };
  } catch (err) {
    return {
      shop: session.shop,
      omsUrl,
      state: "error",
      install: null,
      error: err.message,
    };
  }
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const email = String(form.get("email") || "");

  if (!email.includes("@")) {
    return { ok: false, message: "Enter the email address you sign in to FynkTech OMS with." };
  }

  try {
    const result = await claimPendingInstall({ shopDomain: session.shop, email });
    if (result.ok) {
      return { ok: true, message: `Linked to ${result.organization.organizationName}.` };
    }
    if (result.reason === "already_linked") {
      return { ok: false, message: "This store is already linked to an organization." };
    }
    return {
      ok: false,
      message:
        "No FynkTech OMS account matches that email. Use the address you sign in " +
        "to the OMS with, or ask your administrator to invite you first.",
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
};

function renderStatusBanner({ state, install, error }) {
  if (state === "misconfigured") {
    return (
      <s-banner tone="critical" heading="App is not configured">
        <s-paragraph>
          OMS_DATABASE_URL is not set on this deployment, so credentials cannot be
          handed to the OMS. Contact FynkTech support.
        </s-paragraph>
      </s-banner>
    );
  }
  if (state === "error") {
    return (
      <s-banner tone="critical" heading="Could not reach FynkTech OMS">
        <s-paragraph>{error}</s-paragraph>
      </s-banner>
    );
  }
  if (state === "not_staged") {
    return (
      <s-banner tone="warning" heading="Credentials were not captured">
        <s-paragraph>
          Reinstalling the app will retry. If this persists, contact FynkTech support.
        </s-paragraph>
      </s-banner>
    );
  }
  if (state === "linked") {
    return (
      <s-banner tone="success" heading={`Ready to connect in ${install.organizationName}`}>
        <s-paragraph>
          Your store credentials have been sent to FynkTech OMS. Open the OMS and
          press <s-text fontWeight="bold">Connect</s-text> to start syncing orders.
        </s-paragraph>
      </s-banner>
    );
  }
  return (
    <s-banner tone="info" heading="One more step">
      <s-paragraph>
        We could not automatically match this store to a FynkTech OMS account
        {install?.installedByEmail ? ` from ${install.installedByEmail}` : ""}. Enter
        your OMS sign-in email below to finish linking.
      </s-paragraph>
    </s-banner>
  );
}

export default function Index() {
  const { shop, omsUrl, state, install, error } = useLoaderData();
  const fetcher = useFetcher();
  const shopifyBridge = useAppBridge();
  const [email, setEmail] = useState("");

  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopifyBridge.toast.show(fetcher.data.message);
  }, [fetcher.data, shopifyBridge]);

  const claim = () => fetcher.submit({ email }, { method: "POST" });
  const linked = state === "linked";

  return (
    <s-page heading="FynkTech OMS connection">
      {linked && omsUrl && (
        <s-button
          slot="primary-action"
          href={`${omsUrl}/integrations/shopify`}
          target="_blank"
        >
          Open FynkTech OMS
        </s-button>
      )}

      <s-section>
        {renderStatusBanner({ state, install, error })}
      </s-section>

      <s-section heading="Store">
        <s-stack direction="block" gap="tight">
          <s-paragraph>
            <s-text fontWeight="bold">Domain</s-text> — {shop}
          </s-paragraph>
          {install?.shopName && (
            <s-paragraph>
              <s-text fontWeight="bold">Name</s-text> — {install.shopName}
            </s-paragraph>
          )}
          {install?.currency && (
            <s-paragraph>
              <s-text fontWeight="bold">Currency</s-text> — {install.currency}
            </s-paragraph>
          )}
          <s-paragraph>
            <s-text fontWeight="bold">Permissions granted</s-text> —{" "}
            {install?.scopes?.length ?? 0}
          </s-paragraph>
        </s-stack>
      </s-section>

      {state === "unassigned" && (
        <s-section heading="Link to your FynkTech OMS account">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="FynkTech OMS email"
              name="email"
              value={email}
              placeholder="you@yourcompany.com"
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            {fetcher.data && !fetcher.data.ok && (
              <s-banner tone="critical">
                <s-paragraph>{fetcher.data.message}</s-paragraph>
              </s-banner>
            )}
            <s-button
              onClick={claim}
              {...(isSubmitting ? { loading: true } : {})}
            >
              Link store
            </s-button>
          </s-stack>
        </s-section>
      )}

      <s-section heading="What FynkTech OMS will do with this store">
        <s-stack direction="block" gap="tight">
          <s-paragraph>
            <s-text fontWeight="bold">Orders</s-text> — import order history and keep
            it in sync, including edits, cancellations and refunds.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Fulfilment &amp; warehouse</s-text> — read
            fulfilment orders and locations, push fulfilments and tracking back to
            Shopify as your warehouse picks and ships.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Inventory</s-text> — keep stock levels aligned
            between your warehouse and this store.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Returns</s-text> — manage return requests,
            approvals and restocking from the OMS.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Finance</s-text> — reconcile payouts, disputes
            and order transactions.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}
