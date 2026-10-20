const styles = {
  page: {
    maxWidth: "760px",
    margin: "0 auto",
    padding: "48px 24px 96px",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#1a1a1a",
    lineHeight: 1.6,
  },
  h1: { fontSize: "28px", marginBottom: "4px" },
  updated: { color: "#666", fontSize: "14px", marginBottom: "32px" },
  h2: { fontSize: "20px", marginTop: "36px", marginBottom: "8px" },
  p: { marginBottom: "12px" },
  ul: { marginBottom: "12px", paddingLeft: "24px" },
};

export default function Privacy() {
  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Privacy Policy</h1>
      <p style={styles.updated}>Last updated: October 2026</p>

      <p style={styles.p}>
        Connector ("the app") connects a Shopify store to a merchant's
        FynkTech OMS account so that store data can be kept in sync between
        the two systems. This page describes what data the app collects, why,
        and how it's handled.
      </p>

      <h2 style={styles.h2}>Information we collect</h2>
      <p style={styles.p}>When a merchant installs the app, we collect:</p>
      <ul style={styles.ul}>
        <li>Your store's domain, name, and currency</li>
        <li>
          An Admin API access token (and refresh token) scoped to the
          permissions you grant during installation
        </li>
        <li>The list of permissions (scopes) granted</li>
        <li>
          The Shopify store contact email (from your shop profile), used as
          one signal to match the install to a FynkTech OMS organization when
          possible
        </li>
        <li>
          Optionally, the email address of the FynkTech OMS user who claims
          or completes the connection in FynkTech OMS (for example after
          signing in and linking the store)
        </li>
      </ul>
      <p style={styles.p}>
        Connector does not store Shopify customer (buyer) profiles as its own
        primary records. The access token allows your FynkTech OMS account to
        sync store data that may include customer names, addresses, and order
        details. That synced data is held in your organization's FynkTech OMS
        account under your control and is governed by your use of FynkTech OMS.
      </p>

      <h2 style={styles.h2}>Permissions we request</h2>
      <p style={styles.p}>
        Depending on what you approve at install time, Connector may request
        access needed for OMS sync, including (read and/or write where
        applicable):
      </p>
      <ul style={styles.ul}>
        <li>Orders, draft orders, order edits, and related order history</li>
        <li>Customers</li>
        <li>Products, files, and inventory / locations</li>
        <li>Fulfilments and fulfilment orders</li>
        <li>Returns and shipping</li>
        <li>Discounts and price rules</li>
        <li>Shopify Payments payouts and disputes (read)</li>
      </ul>
      <p style={styles.p}>
        We only use these permissions to operate the connection between your
        Shopify store and your FynkTech OMS account.
      </p>

      <h2 style={styles.h2}>How we use this information</h2>
      <p style={styles.p}>
        Solely to operate that connection: importing and syncing orders,
        customers, products, files, inventory, fulfilments, returns, shipping,
        discounts, and related finance/payment records your OMS needs. We do
        not use this data for advertising, profiling, or any purpose unrelated
        to that sync.
      </p>

      <h2 style={styles.h2}>After installation</h2>
      <p style={styles.p}>
        After you approve permissions in Shopify, this app shows a short
        confirmation screen and then continues you to your FynkTech OMS
        dashboard (or you can open it with the Continue button). Final
        connection of the store is completed in FynkTech OMS, not inside
        Shopify Admin. That handoff is expected for this Connector and is
        disclosed here so the flow is clear.
      </p>

      <h2 style={styles.h2}>Data sharing</h2>
      <p style={styles.p}>
        We do not sell or share your data with third parties. Data collected
        by this app stays within FynkTech's own systems — this app and the
        FynkTech OMS your organization uses.
      </p>

      <h2 style={styles.h2}>Data retention and deletion</h2>
      <p style={styles.p}>
        While the app is installed, we retain the access token, refresh token,
        and staged install metadata needed to keep the connection working.
      </p>
      <p style={styles.p}>When you uninstall the app:</p>
      <ul style={styles.ul}>
        <li>
          Shopify revokes the app's access. We immediately clear the stored
          access and refresh tokens and remove local install sessions for your
          shop.
        </li>
        <li>
          Within 48 hours, Shopify's shop/redact process triggers deletion of
          the Connector's staged install record for your shop (shop domain and
          related install metadata held for connecting the app).
        </li>
        <li>
          Business data already synced into your FynkTech OMS organization
          (for example orders already imported) remains in that OMS account
          under your organization's control. You can remove or request deletion
          of that OMS data from within FynkTech OMS or by contacting us.
        </li>
      </ul>

      <h2 style={styles.h2}>Security</h2>
      <p style={styles.p}>
        All data is transmitted over encrypted HTTPS connections. Access
        tokens are stored in access-controlled databases and are only used
        server-side to make Admin API calls on your store's behalf.
      </p>

      <h2 style={styles.h2}>Your rights</h2>
      <p style={styles.p}>
        You can request details of the data we hold about your store, or
        request its deletion, at any time by contacting us (see below), or
        by uninstalling the app (which clears Connector tokens and, within
        Shopify's required window, the staged install record).
      </p>

      <h2 style={styles.h2}>Changes to this policy</h2>
      <p style={styles.p}>
        We may update this policy from time to time. Material changes will
        be reflected by updating the "Last updated" date above.
      </p>

      <h2 style={styles.h2}>Contact</h2>
      <p style={styles.p}>
        Questions about this policy or your data can be sent to{" "}
        <a href="mailto:fynktech@gmail.com">fynktech@gmail.com</a>.
      </p>
    </div>
  );
}
