"use client";

import { useMemo, useState, useTransition } from "react";
import { formatZAR } from "@/lib/utils";
import { createCounterOrderAction } from "./actions";
import styles from "./counter.module.css";

export interface CounterProduct {
  id: string;
  name: string;
  price: string;
}

/**
 * The POS grid + running ticket. Client-side quantities/total here are
 * DISPLAY only — createCounterOrderAction re-fetches each product's
 * current price server-side before creating the order, the same
 * never-trust-the-client-total rule the customer-facing checkout already
 * follows.
 */
export default function CounterPOS({ products }: { products: CounterProduct[] }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD">("CASH");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => {
          const product = products.find((p) => p.id === id);
          return product ? { product, qty } : null;
        })
        .filter((l): l is { product: CounterProduct; qty: number } => l !== null),
    [cart, products],
  );

  const total = lines.reduce((sum, l) => sum + Number(l.product.price) * l.qty, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.qty, 0);

  function add(productId: string) {
    setPlaced(null);
    setCart((c) => ({ ...c, [productId]: (c[productId] ?? 0) + 1 }));
  }

  function remove(productId: string) {
    setCart((c) => {
      const next = { ...c };
      const qty = (next[productId] ?? 0) - 1;
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  }

  function placeOrder() {
    setError(null);
    const formData = new FormData();
    formData.set("items", JSON.stringify(lines.map((l) => ({ productId: l.product.id, quantity: l.qty }))));
    formData.set("paymentMethod", paymentMethod);
    startTransition(async () => {
      const result = await createCounterOrderAction(formData);
      if (result.ok) {
        setCart({});
        setPlaced("Order placed.");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className={styles.pos}>
      <div className={styles.posGrid}>
        {products.length === 0 ? (
          <p className={styles.empty}>No products available at the counter yet — add some in Menu.</p>
        ) : (
          products.map((product) => (
            <button key={product.id} type="button" className={styles.posItem} onClick={() => add(product.id)}>
              <span className={styles.posItemName}>{product.name}</span>
              <span className={styles.posItemPrice}>{formatZAR(product.price)}</span>
            </button>
          ))
        )}
      </div>

      <div className={`card ${styles.ticket}`}>
        <p className={styles.ticketTitle}>Current order</p>
        {lines.length === 0 ? (
          <p className={styles.ticketEmpty}>Tap items to add them.</p>
        ) : (
          <ul className={styles.ticketList}>
            {lines.map((l) => (
              <li key={l.product.id} className={styles.ticketLine}>
                <div className={styles.qtyControls}>
                  <button type="button" onClick={() => remove(l.product.id)} aria-label={`Remove one ${l.product.name}`}>
                    −
                  </button>
                  <span>{l.qty}</span>
                  <button type="button" onClick={() => add(l.product.id)} aria-label={`Add one ${l.product.name}`}>
                    +
                  </button>
                </div>
                <span className={styles.ticketLineName}>{l.product.name}</span>
                <span className={styles.ticketLinePrice}>{formatZAR(Number(l.product.price) * l.qty)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.ticketTotal}>
          <span>Total</span>
          <span>{formatZAR(total)}</span>
        </div>

        <div className={styles.paymentToggle}>
          <button
            type="button"
            className={paymentMethod === "CASH" ? styles.paymentActive : ""}
            onClick={() => setPaymentMethod("CASH")}
          >
            Cash
          </button>
          <button
            type="button"
            className={paymentMethod === "CARD" ? styles.paymentActive : ""}
            onClick={() => setPaymentMethod("CARD")}
          >
            Card
          </button>
        </div>

        {error && <p className={styles.ticketError}>{error}</p>}
        {placed && <p className={styles.ticketSuccess}>{placed}</p>}

        <button
          type="button"
          className={styles.takePaymentBtn}
          disabled={itemCount === 0 || pending}
          onClick={placeOrder}
        >
          {pending ? "Placing…" : `Take payment · ${formatZAR(total)}`}
        </button>
      </div>
    </div>
  );
}
