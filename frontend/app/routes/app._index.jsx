import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { apiVersion, authenticate } from "../shopify.server";
import {
  claimPendingInstall,
  getPendingInstall,
  isOmsConfigured,
  stageInstall,
  withOmsTimeout,
} from "../oms.server";

// eslint-disable-next-line no-undef
const OMS_URL = () => (process.env.OMS_APP_URL || "").replace(/\/+$/, "");

/**
 * The staged row for this shop, staging it first if there is none usable.
 *
 * Reaching this loader means the app is installed and we hold a live token,
 * so a missing row - or one whose token was blanked by an earlier uninstall,
 * or only reserved by the OMS and never filled - is something to repair here,
 * not to report. See stageInstall for why afterAuth cannot be relied on alone.
 */
async function loadOrStageInstall(session, admin) {
  const install = await getPendingInstall(session.shop);
  if (install?.access_token) return install;

  await stageInstall({ session, admin, apiVersion });
  return getPendingInstall(session.shop);
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const omsUrl = OMS_URL();

  if (!isOmsConfigured()) {
    return { shop: session.shop, omsUrl, state: "misconfigured", install: null };
  }

  try {
    const install = await withOmsTimeout(loadOrStageInstall(session, admin), 9_000);
    if (!install) {
      return { shop: session.shop, omsUrl, state: "not_staged", install: null };
    }
    return {
      shop: session.shop,
      omsUrl,
      state:
        install.status === "connected"
          ? "connected"
          : install.organization_id
            ? "linked"
            : "unassigned",
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
    // admin.graphql throws a Response when Shopify rejects the stored token;
    // it carries the headers that make App Bridge re-authenticate and retry.
    if (err instanceof Response) throw err;
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

function renderStatusBanner({ state, install, error, onRetry, retrying }) {
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
        <s-paragraph>{error || "Something went wrong talking to FynkTech OMS."}</s-paragraph>
        <s-button onClick={onRetry} {...(retrying ? { loading: true } : {})}>
          Try again
        </s-button>
      </s-banner>
    );
  }
  if (state === "not_staged") {
    return (
      <s-banner tone="warning" heading="Credentials were not captured">
        <s-paragraph>
          We could not hand this store&apos;s details to FynkTech OMS yet. Try again;
          if this persists, contact FynkTech support.
        </s-paragraph>
        <s-button onClick={onRetry} {...(retrying ? { loading: true } : {})}>
          Try again
        </s-button>
      </s-banner>
    );
  }
  if (state === "connected") {
    return (
      <s-banner tone="success" heading={`Connected to ${install.organizationName}`}>
        <s-paragraph>
          This store is connected and syncing with FynkTech OMS. Press{" "}
          <s-text fontWeight="bold">Open FynkTech OMS</s-text> above to manage orders,
          inventory and other settings.
        </s-paragraph>
      </s-banner>
    );
  }
  if (state === "linked") {
    return (
      <s-banner tone="success" heading={`Ready to connect in ${install.organizationName}`}>
        <s-paragraph>
          Installation on Shopify is complete. This Connector app only stages your
          store credentials — the connection is finished in{" "}
          <s-text fontWeight="bold">FynkTech OMS</s-text> (the dashboard where you
          started Connect). You will be taken there in a few seconds, or use{" "}
          <s-text fontWeight="bold">Continue to FynkTech OMS</s-text> above.
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
  const revalidator = useRevalidator();
  const [email, setEmail] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      setSuccessMessage(fetcher.data.message || "Linked successfully.");
    }
  }, [fetcher.data]);

  const claim = () => fetcher.submit({ email }, { method: "POST" });
  const linked = state === "linked";
  const connected = state === "connected";
  // `linked` means the pending row already has an organization_id (via
  // backend-fastapi's POST /start pre-assignment, or afterAuth's email
  // match) - not that the OMS has finalized the connection yet. Appending
  // ?connected=1 makes the OMS's existing auto-finalize effect run the
  // instant the merchant lands there.
  // `connected` means the OMS already finalized this store on a previous
  // visit - no need for that query param again, just open the OMS.
  const omsHref =
    omsUrl && (linked || connected)
      ? `${omsUrl}/integrations/shopify${linked ? "?connected=1" : ""}`
      : null;

  // App Store–friendly handoff (non-embedded): show Connector UI, then
  // continue to FynkTech OMS after a short delay (manual button also works).
  useEffect(() => {
    if (!linked || !omsHref) return;
    const timer = window.setTimeout(() => {
      window.location.assign(omsHref);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [linked, omsHref]);

  return (
    <s-page heading="FynkTech OMS connection">
      {omsHref && (
        <s-button
          slot="primary-action"
          href={omsHref}
          target="_self"
          variant="primary"
        >
          {linked ? "Continue to FynkTech OMS" : "Open FynkTech OMS"}
        </s-button>
      )}

      <s-section>
        {successMessage ? (
          <s-banner tone="success" heading="Linked">
            <s-paragraph>{successMessage}</s-paragraph>
          </s-banner>
        ) : null}
        {renderStatusBanner({
          state,
          install,
          error,
          onRetry: () => revalidator.revalidate(),
          retrying: revalidator.state !== "idle",
        })}
        {omsHref && (linked || connected) && (
          <s-stack direction="block" gap="base">
            <s-button href={omsHref} target="_self" variant="primary">
              {linked ? "Continue to FynkTech OMS" : "Open FynkTech OMS"}
            </s-button>
            {linked && (
              <s-paragraph>
                Or wait a few seconds — we will open FynkTech OMS automatically.
              </s-paragraph>
            )}
          </s-stack>
        )}
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
            {omsUrl && (
              <s-paragraph>
                Use the email you sign in to FynkTech OMS with.{" "}
                <s-link href={omsUrl} target="_blank">
                  Open FynkTech OMS
                </s-link>{" "}
                to check your account.
              </s-paragraph>
            )}
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
