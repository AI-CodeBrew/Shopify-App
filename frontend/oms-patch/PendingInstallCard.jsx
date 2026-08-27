/*
 * Drop-in card for frontend/app/(tenant)/integrations/shopify/page.jsx.
 *
 * Renders directly ABOVE the existing "Connect Shopify Store" card (the one at
 * ~line 630 that starts with <ShieldIcon />). The manual credential form stays
 * exactly as it is - it remains the fallback for merchants who would rather
 * create their own custom app, and the path for stores connected before the
 * FynkTech AI app existed.
 *
 * ---------------------------------------------------------------------------
 * 1. Paste this component above `export default function IntegrationsPage()`.
 * 2. Inside that component, add state + a load in the existing effect:
 *
 *      const [pending, setPending] = useState(null);
 *      const [connectingPending, setConnectingPending] = useState(false);
 *
 *      // in the same effect that calls getShopifyStatus():
 *      integrationsService
 *        .getPendingInstall()
 *        .then((p) => setPending(p.pending ? p : null))
 *        .catch(() => setPending(null));   // never block the page on this
 *
 * 3. Add the handler:
 *
 *      async function onConnectPending() {
 *        setConnectingPending(true);
 *        setError("");
 *        try {
 *          const data = await integrationsService.connectFromPendingInstall();
 *          setStatus({ ...data, connected: true });
 *          setPending(null);
 *          setNotice("Shopify store connected.");
 *        } catch (err) {
 *          setError(err.message);
 *        } finally {
 *          setConnectingPending(false);
 *        }
 *      }
 *
 * 4. Render it, only when there is something to show and we are not already
 *    connected to that same store:
 *
 *      {pending && !connected && (
 *        <PendingInstallCard
 *          pending={pending}
 *          busy={connectingPending}
 *          onConnect={onConnectPending}
 *        />
 *      )}
 * ---------------------------------------------------------------------------
 */

function PendingInstallCard({ pending, busy, onConnect }) {
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-6">
      <div className="flex items-center gap-2">
        <BoltIcon className="h-5 w-5 text-brand-600" />
        <h2 className="text-base font-semibold text-slate-900">
          Shopify store ready to connect
        </h2>
      </div>

      <p className="mt-1 text-sm text-slate-600">
        The FynkTech AI app was installed on{" "}
        <span className="font-medium text-brand-700">{pending.shop_domain}</span>
        {pending.shop_name ? ` (${pending.shop_name})` : ""}. Its Admin API
        credentials are already here — no token to copy.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Store</dt>
          <dd className="mt-0.5 truncate font-medium text-slate-900">{pending.shop_domain}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Currency</dt>
          <dd className="mt-0.5 font-medium text-slate-900">{pending.currency || "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Permissions</dt>
          <dd className="mt-0.5 font-medium text-slate-900">{pending.scope_count} granted</dd>
        </div>
        <div>
          <dt className="text-slate-500">Installed by</dt>
          <dd className="mt-0.5 truncate font-medium text-slate-900">
            {pending.installed_by_email || "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={onConnect} disabled={busy}>
          {busy ? "Connecting…" : "Connect"}
        </Button>
        <span className="text-xs text-slate-500">
          Verifies the store and registers order webhooks.
        </span>
      </div>
    </div>
  );
}
