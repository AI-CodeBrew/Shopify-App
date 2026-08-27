import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Connect your store to FynkTech OMS</h1>
        <p className={styles.text}>
          Install once and your store is linked. No custom app to create, no
          access token to copy.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
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
