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
      <p style={styles.updated}>Last updated: September 2026</p>

      <p style={styles.p}>
        FynkTech AI ("the app") connects a Shopify store to a merchant's
        FynkTech OMS account, so that order, fulfilment, inventory, returns
        and finance data can be kept in sync between the two systems. This
        page describes what data the app collects, why, and how it's
        handled.
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
          The email address of the staff member who installed the app, used
          to match the install to the correct FynkTech OMS organization
        </li>
      </ul>
      <p style={styles.p}>
        The app itself does not read or store your customers' personal
        data directly. The access token lets your FynkTech OMS account sync
        order records (which may include customer names, addresses, and
        order details) - that data is governed by your own organization's
        use of FynkTech OMS, under your control.
      </p>

      <h2 style={styles.h2}>How we use this information</h2>
      <p style={styles.p}>
        Solely to operate the connection between your Shopify store and your
        FynkTech OMS account: importing and syncing orders, fulfilment
        orders, inventory levels, returns, and finance records. We do not
        use this data for advertising, profiling, or any purpose unrelated
        to that sync.
      </p>

      <h2 style={styles.h2}>Data sharing</h2>
      <p style={styles.p}>
        We do not sell or share your data with third parties. Data collected
        by this app stays within FynkTech's own systems - this app and the
        FynkTech OMS your organization uses.
      </p>

      <h2 style={styles.h2}>Data retention and deletion</h2>
      <p style={styles.p}>
        Your access token and staged install data are retained for as long
        as the app remains installed on your store. If you uninstall the
        app, the stored access token is immediately invalidated, and all
        associated data is permanently deleted within 48 hours, in line with
        Shopify's mandatory data-protection requirements.
      </p>

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
        simply by uninstalling the app.
      </p>

      <h2 style={styles.h2}>Changes to this policy</h2>
      <p style={styles.p}>
        We may update this policy from time to time. Material changes will
        be reflected by updating the "Last updated" date above.
      </p>

      <h2 style={styles.h2}>Contact</h2>
      <p style={styles.p}>
        Questions about this policy or your data can be sent to{" "}
        <a href="mailto:support@fynktech.com">support@fynktech.com</a>.
      </p>
    </div>
  );
}
