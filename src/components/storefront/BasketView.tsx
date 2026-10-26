"use client";

import { quoteErrorMessage } from "./quote-error-message";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatZAR } from "@/lib/utils";
import { useCart } from "@/lib/storefront/useCart";
import { MAX_LINE_QUANTITY } from "@/lib/storefront/cart";
import type { CartQuote, QuoteError } from "@/modules/orders/storefront-cart";
import viewStyles from "@/components/StorefrontView.module.css";
import stepperStyles from "./ProductsSection.module.css";
import styles from "./BasketView.module.css";

type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: CartQuote }
  | { status: "error"; code: QuoteError["code"] | "REQUEST_FAILED" };

/**
 * ORDER REVIEW only — see BasketPage's doc comment. Fetches a fresh,
 * server-authoritative quote (resolveStorefrontCartQuote, via
 * /api/store/checkout/quote) whenever the cart changes, so the price/
 * availability shown here is never a stale localStorage value — it's
 * DISPLAY only until the customer actually places the order, but it must
 * still be the real current price, not whatever was cached at Add time.
 */
export default function BasketView({ businessId, basePath }: { businessId: string; basePath: string }) {
  const cart = useCart(businessId);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });

  useEffect(() => {
    if (!cart.hydrated) return;
    if (cart.lines.length === 0) {
      // Same data-fetch-in-effect pattern as the "loading" branch below —
      // resetting to idle when the basket empties is part of synchronizing
      // this view with the (external, localStorage-backed) cart, not state
      // derivable from props/other state alone.
      // Bare disable (no rule name): local eslint-plugin-react-hooks
      // doesn't define this rule, Vercel's fresh install does and flags
      // this line — see dashboard/page.tsx's identical note.
      // eslint-disable-next-line
      setQuoteState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setQuoteState({ status: "loading" });
    fetch("/api/store/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, lines: cart.lines, fulfilmentMethod: "COLLECTION" }),
    })
      .then((r) => r.json())
      .then((result) => {
        if (cancelled) return;
        setQuoteState(result.ok ? { status: "ready", quote: result.quote } : { status: "error", code: result.code });
      })
      .catch(() => {
        if (!cancelled) setQuoteState({ status: "error", code: "REQUEST_FAILED" });
      });
    return () => {
      cancelled = true;
    };
    // cart.lines is a fresh array each render; comparing its JSON avoids
    // re-fetching on every keystroke-unrelated re-render while still
    // firing whenever the actual line contents change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, cart.hydrated, JSON.stringify(cart.lines)]);

  if (!cart.hydrated) return null;

  if (cart.lines.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Your basket is empty.</p>
        <Link href={basePath || "/"} className="btn btnSecondary">
          Back to store
        </Link>
      </div>
    );
  }

  return (
    <div>
      {quoteState.status === "loading" && <p className={styles.empty}>Checking current prices…</p>}

      {quoteState.status === "error" && (
        <div className="errorBanner">
          {quoteErrorMessage(quoteState.code)}
        </div>
      )}

      {quoteState.status === "ready" && (
        <>
          {quoteState.quote.removedLines.length > 0 && (
            <p className={styles.removedNotice} role="status">
              {quoteState.quote.removedLines.length === 1
                ? "One item in your basket is no longer available and was removed."
                : `${quoteState.quote.removedLines.length} items in your basket are no longer available and were removed.`}
            </p>
          )}
          {quoteState.quote.adjustedLines.length > 0 && (
            <p className={styles.adjustedNotice} role="status">
              A quantity in your basket was adjusted.
            </p>
          )}

          <ul className={styles.lineList}>
            {quoteState.quote.lines.map((line) => {
              const optionIds = line.options.map((o) => o.optionId);
              return (
                <li key={line.lineKey} className={styles.line}>
                  <div className={styles.lineInfo}>
                    <span className={styles.lineName}>{line.name}</span>
                    {line.options.length > 0 && (
                      <span className={styles.lineUnitPrice}>
                        {line.options.map((o) => o.optionName).join(", ")}
                      </span>
                    )}
                    <span className={styles.lineUnitPrice}>{formatZAR(line.configuredUnitPrice)} each</span>
                    <span className={styles.lineTotal}>{formatZAR(line.lineTotal)}</span>
                  </div>
                  <div className={stepperStyles.stepper} role="group" aria-label={`${line.name} quantity`}>
                    <button
                      type="button"
                      className={stepperStyles.stepperButton}
                      onClick={() =>
                        line.quantity === 1
                          ? cart.removeLineByKey(line.lineKey)
                          : cart.addConfiguredLine(line.productId, optionIds, -1)
                      }
                      aria-label={line.quantity === 1 ? `Remove ${line.name}` : `Decrease ${line.name} quantity`}
                    >
                      {line.quantity === 1 ? "×" : "−"}
                    </button>
                    <span className={stepperStyles.stepperQty}>{line.quantity}</span>
                    <button
                      type="button"
                      className={stepperStyles.stepperButton}
                      onClick={() => cart.addConfiguredLine(line.productId, optionIds, 1)}
                      disabled={line.quantity >= MAX_LINE_QUANTITY}
                      aria-label={`Increase ${line.name} quantity`}
                    >
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className={styles.summary}>
            <div className={styles.summaryRow}>
              <span>Subtotal</span>
              <span>{formatZAR(quoteState.quote.subtotal)}</span>
            </div>
            <p className={styles.lineUnitPrice}>Delivery fee, if any, is added at checkout.</p>
          </div>

          <Link
            href={`${basePath}/checkout`}
            data-sf-event="CHECKOUT_START"
            className={`btn ${viewStyles.storeActionPrimary} ${styles.continueButton}`}
          >
            Continue to checkout — {formatZAR(quoteState.quote.subtotal)}
          </Link>
        </>
      )}
    </div>
  );
}
