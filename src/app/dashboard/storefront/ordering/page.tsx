import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { getDeliverySettings, getOrderingSettings, MAX_PREP_MINUTES } from "@/modules/tenant/capabilities";
import DashboardNav from "@/components/DashboardNav";
import { updateOrderingDelivery, updateOrderingMinimum, updateOrderingPrepTime } from "./actions";
import styles from "../storefront.module.css";

export const dynamic = "force-dynamic";

/**
 * Storefront-facing ORDERING CONFIGURATION (§13/§14) — what customers see
 * and choose at checkout, not operational order management (that stays
 * RUN YOUR BUSINESS → Orders, untouched). Collection has no configurable
 * state today (verified against storefront-cart.ts's resolveStorefrontCartQuote
 * — it's simply the fallback fulfilment method whenever Delivery isn't
 * chosen or isn't enabled), so it's presented as a plain fact, not a
 * pointless toggle (§13's own instruction). Delivery reuses the exact same
 * setDeliverySettings write path as dashboard/settings — see
 * ordering/actions.ts.
 */
export default async function StorefrontOrderingPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; err?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    permitted = false;
  }

  const business = permitted ? await prisma.business.findUnique({ where: { id: session.tenantId } }) : null;
  const hasOrders = workspaceContext.capabilities.has("ORDERS");
  const hasDelivery = workspaceContext.capabilities.has("DELIVERY");
  const delivery = business ? getDeliverySettings(business) : null;
  const ordering = business ? getOrderingSettings(business) : null;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Ordering</h1>
        <p className={styles.sub}>How customers get what they order.</p>

        <DashboardNav current="storefront" {...workspaceContext} />

        {!hasOrders ? (
          <div className={`card ${styles.section}`} style={{ padding: 16 }}>
            <p>Ordering isn&apos;t turned on for this business yet.</p>
          </div>
        ) : !permitted ? (
          <div className="errorBanner">
            Your role doesn&apos;t have permission to change ordering settings — ask the business owner.
          </div>
        ) : !business || !delivery || !ordering ? (
          <div className="errorBanner">Could not load your business.</div>
        ) : (
          <>
            {sp.saved === "1" && <div className="successBanner">Saved.</div>}
            {sp.err && <div className="errorBanner">{sp.err}</div>}

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Collection</h2>
              <p className={styles.infoSub}>
                Always available — customers can always choose to collect their order from you.
              </p>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Minimum order</h2>
              <p className={styles.infoSub}>Applies to every order — collection and delivery. Leave at 0 for no minimum.</p>
              <form action={updateOrderingMinimum} className={styles.form}>
                <div className="field">
                  <label className="label" htmlFor="minOrder">
                    Minimum order (R)
                  </label>
                  <input
                    className="input"
                    id="minOrder"
                    name="minOrder"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={(ordering.minOrderCents / 100).toFixed(2)}
                  />
                </div>
                <button type="submit" className="btn btnPrimary">
                  Save minimum order
                </button>
              </form>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Preparation time</h2>
              <p className={styles.infoSub}>
                How long an order usually takes to get ready. Customers see it as the expected time on their confirmation. Leave at 0 to show no estimate.
              </p>
              <form action={updateOrderingPrepTime} className={styles.form}>
                <div className="field">
                  <label className="label" htmlFor="prepMinutes">
                    Minutes (0–{MAX_PREP_MINUTES})
                  </label>
                  <input
                    className="input"
                    id="prepMinutes"
                    name="prepMinutes"
                    type="number"
                    step="1"
                    min="0"
                    max={MAX_PREP_MINUTES}
                    inputMode="numeric"
                    defaultValue={ordering.prepMinutes}
                  />
                </div>
                <button type="submit" className="btn btnPrimary">
                  Save preparation time
                </button>
              </form>
            </section>

            {hasDelivery ? (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Delivery</h2>
                <form action={updateOrderingDelivery} className={styles.form}>
                  <div className="field">
                    <label className={styles.row} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" id="deliveryEnabled" name="enabled" defaultChecked={delivery.enabled} />
                      Offer delivery to customers
                    </label>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="deliveryFee">
                      Delivery fee (R)
                    </label>
                    <input
                      className="input"
                      id="deliveryFee"
                      name="fee"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={(delivery.feeCents / 100).toFixed(2)}
                    />
                    <span className={styles.fieldHint}>Added to every delivery order, on top of the item total.</span>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="deliveryAreaInfo">
                      Delivery area (optional)
                    </label>
                    <input
                      className="input"
                      id="deliveryAreaInfo"
                      name="areaInfo"
                      maxLength={300}
                      placeholder="e.g. Soweto and surrounding suburbs only"
                      defaultValue={delivery.areaInfo ?? ""}
                    />
                    <span className={styles.fieldHint}>Shown to customers before they choose Delivery.</span>
                  </div>
                  <button type="submit" className="btn btnPrimary">
                    Save delivery settings
                  </button>
                </form>
              </section>
            ) : (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Delivery</h2>
                <p className={styles.infoSub}>Not offered — customers can only collect their order.</p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
