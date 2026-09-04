import styles from "./styles.module.css";

// Shown only if a merchant opens this app's raw URL directly - the normal
// path is the OMS's "Connect Shopify" button, which already knows the shop
// domain and links straight to /auth?shop=... (see backend-fastapi's
// POST /start), skipping this page entirely.
export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Connect your store to FynkTech OMS</h1>
        <p className={styles.text}>
          Install once and your store is linked. No custom app to create, no
          access token to copy.
        </p>
        <form className={styles.form} method="get" action="/auth">
          <label className={styles.label}>
            <span>Shop domain</span>
            <input className={styles.input} type="text" name="shop" />
            <span>e.g: my-shop-domain.myshopify.com</span>
          </label>
          <button className={styles.button} type="submit">
            Log in
          </button>
        </form>
        <ul className={styles.list}>
          <li>
            <strong>Orders, synced</strong>. Your full order history imports into
            FynkTech OMS and stays current as orders are edited, cancelled or
            refunded.
          </li>
          <li>
            <strong>Warehouse and fulfilment</strong>. Pick, pack and ship from
            the OMS; fulfilments and tracking flow back to Shopify automatically.
          </li>
          <li>
            <strong>Returns and finance</strong>. Handle return requests,
            restocking, payouts and disputes in one place.
          </li>
        </ul>
      </div>
    </div>
  );
}
