"use client";

import { rememberDeliveryUrl } from "./customer-delivery-link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCents, formatZAR } from "@/lib/utils";
import { useCart } from "@/lib/storefront/useCart";
import type { CartQuote } from "@/modules/orders/storefront-cart";
import type { TradingState } from "@/modules/tenant/trading-status";
import { TERMS_VERSION } from "@/lib/legal/documents";
import viewStyles from "@/components/StorefrontView.module.css";
import styles from "./CheckoutView.module.css";

type FulfilmentMethod = "COLLECTION" | "DELIVERY";
type PaymentChoice = "CARD" | "IN_PERSON";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Customer-facing wording for a refused quote. Codes come from resolveStorefrontCartQuote. */
function quoteErrorMessage(code: string, minOrderAmount?: string): string {
  switch (code) {
    case "HOURS_CLOSED":
      return "This business is closed right now.";
    case "ORDERS_PAUSED":
      return "This business has paused new orders for a little while. Please try again soon.";
    case "COLLECTION_UNAVAILABLE":
      return "This business doesn't offer collection.";
    case "DELIVERY_UNAVAILABLE":
      return "This business doesn't offer delivery.";
    case "OUTSIDE_SERVICE_AREA":
      return "Sorry — this business doesn't deliver to that area.";
    case "BELOW_MINIMUM_ORDER":
      return minOrderAmount
        ? `Your basket is below this business's ${minOrderAmount} minimum order.`
        : "Your basket is below the minimum order for this delivery area.";
    case "DELIVERY_PRICING_UNAVAILABLE":
      return "Delivery pricing isn't available right now — please contact the business.";
    case "DELIVERY_DISTANCE_UNAVAILABLE":
      return "We couldn't find that address. Check it and try again.";
    case "CART_EMPTY":
      return "Your basket is empty or no longer available.";
    default:
      return "This business is not currently accepting orders.";
  }
}

/**
 * Single streamlined checkout — Order / Fulfilment / Details / Consent /
 * Review / Place order on one page. Every authoritative number comes from a
 * fresh server quote (resolveStorefrontCartQuote via /api/store/checkout/
 * quote) — the only things this component decides client-side are which
 * fulfilment method to ASK for, which delivery area the customer picked (an
 * id, re-validated server-side) and what the customer typed; the server
 * re-derives and re-validates everything at final submit (/api/store/checkout).
 */
export default function CheckoutView({
  businessId,
  basePath,
  collectionEnabled,
  deliveryEnabled,
  paymentOptions,
  tradingState,
  tradingLabel,
  minOrderAmount,
}: {
  businessId: string;
  basePath: string;
  collectionEnabled: boolean;
  deliveryEnabled: boolean;
  /** Which ways of paying this shop offers — a server fact (its own verified PayFast connection + Settings › Payments). Both true = the customer chooses. */
  paymentOptions: { card: boolean; inPerson: boolean };
  /** OPEN / CLOSED / PAUSED, computed server-side; the real enforcement is the quote's own check. */
  tradingState: TradingState;
  tradingLabel: string;
  /** Formatted ZAR (e.g. "R 100.00") when this business has set a minimum order. */
  minOrderAmount?: string;
}) {
  const router = useRouter();
  const cart = useCart(businessId);

  const [fulfilment, setFulfilment] = useState<FulfilmentMethod>(collectionEnabled ? "COLLECTION" : "DELIVERY");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [deliveryZoneId, setDeliveryZoneId] = useState("");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  // Only a real choice when the shop offers both; otherwise fixed to the one it offers.
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>(paymentOptions.card ? "CARD" : "IN_PERSON");
  const effectivePayment: PaymentChoice = paymentOptions.card && paymentOptions.inPerson ? paymentChoice : paymentOptions.card ? "CARD" : "IN_PERSON";

  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef(newIdempotencyKey());

  // Typing an address must not geocode on every keystroke.
  const [debouncedAddress, setDebouncedAddress] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedAddress(deliveryAddress), 600);
    return () => clearTimeout(t);
  }, [deliveryAddress]);

  // Re-quote on cart, fulfilment, chosen area or (debounced) address change.
  useEffect(() => {
    if (!cart.hydrated || cart.lines.length === 0) return;
    let cancelled = false;
    // eslint-disable-next-line
    setQuoteLoading(true);
    setQuoteError(null);
    fetch("/api/store/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId,
        lines: cart.lines,
        fulfilmentMethod: fulfilment,
        deliveryAddress: fulfilment === "DELIVERY" ? debouncedAddress.trim() || undefined : undefined,
        deliveryZoneId: fulfilment === "DELIVERY" && deliveryZoneId ? deliveryZoneId : undefined,
      }),
    })
      .then((r) => r.json())
      .then((result) => {
        if (cancelled) return;
        setQuoteLoading(false);
        if (result.ok) {
          const q = result.quote as CartQuote;
          setQuote(q);
          // A suburb match pre-selects the area; the customer can still change it.
          if (q.deliveryZone && !deliveryZoneId) setDeliveryZoneId(q.deliveryZone.id);
          return;
        }
        setQuote(null);
        if (result.code === "DELIVERY_UNAVAILABLE" && collectionEnabled) {
          setFulfilment("COLLECTION");
          return;
        }
        setQuoteError(quoteErrorMessage(result.code, minOrderAmount));
      })
      .catch(() => {
        if (!cancelled) {
          setQuoteLoading(false);
          setQuoteError("Could not load your basket. Check your connection.");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, cart.hydrated, JSON.stringify(cart.lines), fulfilment, debouncedAddress, deliveryZoneId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !quote) return;
    if (!consent) {
      setSubmitError("Please accept the Terms to continue.");
      return;
    }
    if (fulfilment === "DELIVERY" && !deliveryAddress.trim()) {
      setSubmitError("Enter a delivery address.");
      return;
    }
    if (quote.deliveryFeePending) {
      setSubmitError(quote.deliveryPricingMode === "ZONE" ? "Choose your delivery area so we can give you the exact fee." : "Enter your delivery address so we can calculate the fee.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          lines: cart.lines,
          fulfilmentMethod: fulfilment,
          deliveryAddress: fulfilment === "DELIVERY" ? deliveryAddress.trim() : undefined,
          deliveryInstructions: fulfilment === "DELIVERY" ? deliveryInstructions.trim() || undefined : undefined,
          deliveryZoneId: fulfilment === "DELIVERY" && deliveryZoneId ? deliveryZoneId : undefined,
          notes: notes.trim() || undefined,
          phone: phone.trim(),
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          consent,
          termsVersion: TERMS_VERSION, // the server refuses a stale one (src/lib/legal/documents.ts)
          paymentChoice: effectivePayment,
          idempotencyKey: idempotencyKeyRef.current,
          expectedTotal: quote.total,
        }),
      });
      const result = await res.json();

      if (result.ok) {
        // Clear only AFTER a real Order exists.
        cart.clear();
        rememberDeliveryUrl(result.orderId, result.deliveryUrl);
        router.push(result.redirectTo);
        return;
      }

      setSubmitting(false);
      if (result.code === "CART_CHANGED" && result.quote) {
        setQuote(result.quote);
        idempotencyKeyRef.current = newIdempotencyKey();
        setSubmitError("Your basket changed — review the updated total below and place your order again.");
        return;
      }
      setSubmitError(result.message || "Could not place your order. Try again.");
    } catch {
      setSubmitting(false);
      setSubmitError("Could not place your order. Check your connection and try again.");
    }
  }

  if (!cart.hydrated) return null;

  if (cart.lines.length === 0) {
    return (
      <div>
        <p className={styles.reviewLineMuted}>Your basket is empty.</p>
        <Link href={basePath || "/"} className="btn btnSecondary">
          Back to store
        </Link>
      </div>
    );
  }

  const canOrder = tradingState === "OPEN";
  const bothMethods = collectionEnabled && deliveryEnabled;
  const zoneMode = fulfilment === "DELIVERY" && quote?.deliveryPricingMode === "ZONE";
  const zones = quote?.deliveryZones ?? [];
  const feeLabel = quote
    ? quote.deliveryFeePending
      ? zoneMode
        ? "choose your area"
        : "enter your address for the fee"
      : formatZAR(quote.deliveryFee)
    : "";

  return (
    <form onSubmit={handleSubmit} noValidate className={styles.layout}>
      <div className={styles.formColumn}>
        {!canOrder && (
          <div className="errorBanner">
            {tradingState === "PAUSED"
              ? `${tradingLabel}. You can browse, but ordering is paused until then.`
              : `${tradingLabel}. You can browse, but ordering is turned off until they reopen.`}
          </div>
        )}
        {!collectionEnabled && !deliveryEnabled && <div className="errorBanner">This business isn&apos;t taking orders online right now.</div>}

        {/* B. HOW DO YOU WANT IT? — a real choice only when both exist; otherwise a plain statement. */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>How do you want it?</h3>
          {bothMethods ? (
            <div className={styles.fulfilmentChoice} role="radiogroup" aria-label="Fulfilment method">
              <label className={`${styles.fulfilmentOption} ${fulfilment === "COLLECTION" ? styles.fulfilmentOptionSelected : ""}`}>
                <input type="radio" name="fulfilment" checked={fulfilment === "COLLECTION"} onChange={() => setFulfilment("COLLECTION")} />
                Collection
              </label>
              <label className={`${styles.fulfilmentOption} ${fulfilment === "DELIVERY" ? styles.fulfilmentOptionSelected : ""}`}>
                <input type="radio" name="fulfilment" checked={fulfilment === "DELIVERY"} onChange={() => setFulfilment("DELIVERY")} />
                Delivery{quote && fulfilment === "DELIVERY" ? ` — ${feeLabel}` : ""}
              </label>
            </div>
          ) : (
            <p className={styles.termsStatus}>{deliveryEnabled ? "Delivery" : "Collection"}</p>
          )}

          {fulfilment === "DELIVERY" && deliveryEnabled && (
            <>
              {zoneMode && (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Delivery area</span>
                  <select className="input" name="deliveryZoneId" value={deliveryZoneId} onChange={(e) => setDeliveryZoneId(e.target.value)} required>
                    <option value="">Choose your area…</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name} — {formatCents(z.feeCents)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Delivery address</span>
                <textarea
                  className="input"
                  rows={2}
                  name="deliveryAddress"
                  autoComplete="street-address"
                  placeholder="House number, street and area"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  required
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Landmark / instructions (optional)</span>
                <textarea
                  className="input"
                  rows={2}
                  name="deliveryInstructions"
                  placeholder="Blue gate opposite the school. Call when outside."
                  value={deliveryInstructions}
                  onChange={(e) => setDeliveryInstructions(e.target.value)}
                />
              </label>
              {quote?.deliveryAreaInfo && <p className={styles.deliveryAreaInfo}>{quote.deliveryAreaInfo}</p>}
            </>
          )}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Note for the shop (optional)</span>
            <input className="input" type="text" name="notes" maxLength={500} placeholder="e.g. no onions, extra napkins" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </section>

        {/* C. YOUR DETAILS — deliberately short. No account, no password. */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Your details</h3>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Full name (optional)</span>
            <input className="input" type="text" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>WhatsApp / phone number</span>
            <input className="input" type="tel" name="phone" inputMode="tel" autoComplete="tel" placeholder="082 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email (optional — for your confirmation and order updates)</span>
            <input className="input" type="email" name="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <p className={styles.reviewLineMuted}>No account needed.</p>
        </section>

        {/* D. HOW WILL YOU PAY? — a real choice only when the shop offers both; otherwise a plain statement. */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>How will you pay?</h3>
          {paymentOptions.card && paymentOptions.inPerson ? (
            <div className={styles.fulfilmentChoice} role="radiogroup" aria-label="How will you pay">
              <label className={`${styles.fulfilmentOption} ${effectivePayment === "CARD" ? styles.fulfilmentOptionSelected : ""}`}>
                <input type="radio" name="paymentChoice" checked={effectivePayment === "CARD"} onChange={() => setPaymentChoice("CARD")} />
                Pay now by card
              </label>
              <label className={`${styles.fulfilmentOption} ${effectivePayment === "IN_PERSON" ? styles.fulfilmentOptionSelected : ""}`}>
                <input type="radio" name="paymentChoice" checked={effectivePayment === "IN_PERSON"} onChange={() => setPaymentChoice("IN_PERSON")} />
                {fulfilment === "DELIVERY" ? "Pay the driver" : "Pay when I collect"}
              </label>
            </div>
          ) : (
            <p className={styles.termsStatus}>
              {paymentOptions.card ? "Card payment, now — you'll be taken to the secure payment page." : fulfilment === "DELIVERY" ? "Pay the driver when your order arrives." : "Pay at the shop when you collect."}
            </p>
          )}
        </section>

        {/* E. CONSENT — once, not per item. */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Consent</h3>
          <label className={styles.consentRow}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
            <span>
              I agree to Skhokho&apos;s{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                Terms
              </a>
            </span>
          </label>
        </section>
      </div>

      <aside className={styles.summaryColumn}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Your order</h3>
            <Link href={`${basePath}/basket`} className={styles.editLink}>
              Edit basket
            </Link>
          </div>
          {minOrderAmount && <p className={styles.reviewLineMuted}>Minimum order: {minOrderAmount}</p>}
          {quoteLoading && <p className={styles.reviewLineMuted}>Checking current prices…</p>}
          {quoteError && <div className="errorBanner" role="alert">{quoteError}</div>}
          {quote?.lines.map((line) => (
            <div key={line.lineKey} className={styles.reviewLine}>
              <span>
                {line.quantity} × {line.name}
                {line.options.length > 0 && <span className={styles.reviewLineMuted}> — {line.options.map((o) => o.optionName).join(", ")}</span>}
              </span>
              <span>{formatZAR(line.lineTotal)}</span>
            </div>
          ))}

          {quote && (
            <>
              <div className={styles.summaryRow}>
                <span>Subtotal</span>
                <span>{formatZAR(quote.subtotal)}</span>
              </div>
              {quote.fulfilmentMethod === "DELIVERY" && (
                <div className={styles.summaryRow}>
                  <span>Delivery{quote.deliveryZone ? ` (${quote.deliveryZone.name})` : ""}</span>
                  <span>{quote.deliveryFeePending ? (zoneMode ? "Choose your area" : "Enter your address") : formatZAR(quote.deliveryFee)}</span>
                </div>
              )}
              <div className={styles.summaryTotalRow}>
                <span>Total</span>
                <span>{quote.deliveryFeePending ? "—" : formatZAR(quote.total)}</span>
              </div>
              <p className={styles.reviewLineMuted}>{quote.fulfilmentMethod === "DELIVERY" ? `Delivery to: ${deliveryAddress || "—"}` : "Collection"}</p>
              <p className={styles.reviewLineMuted}>
                Contact: {phone || "—"}
                {email ? `, ${email}` : ""}
              </p>
              <p className={styles.termsStatus}>{consent ? "Terms accepted" : "Terms not yet accepted"}</p>
            </>
          )}

          {submitError && <div className="errorBanner" role="alert">{submitError}</div>}
          <div className={styles.submitRow}>
            <button
              type="submit"
              className={`btn ${viewStyles.storeActionPrimary} ${styles.submitButton}`}
              disabled={submitting || !quote || quoteLoading || !canOrder || quote?.deliveryFeePending || (!collectionEnabled && !deliveryEnabled)}
            >
              {submitting
                ? "Placing order…"
                : !quote || quote.deliveryFeePending
                  ? "Place order"
                  : effectivePayment === "CARD"
                    ? `Place order & pay ${formatZAR(quote.total)}`
                    : fulfilment === "DELIVERY"
                      ? `Place order — pay the driver ${formatZAR(quote.total)}`
                      : `Place order — pay on collection ${formatZAR(quote.total)}`}
            </button>
          </div>
        </section>
      </aside>
    </form>
  );
}
