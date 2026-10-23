import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { getDeliverySettings, getFulfilmentSettings } from "@/modules/tenant/capabilities";
import { listZones } from "@/modules/delivery/zones.service";
import { lethaEnabled } from "@/modules/skhokholetha/flags";
import { formatCents } from "@/lib/utils";
import DashboardNav from "@/components/DashboardNav";
import { addZoneAction, deleteZoneAction, moveZoneAction, saveZoneAction, toggleZoneAction, updateFulfilmentAction } from "./actions";
import styles from "../settings.module.css";

export const dynamic = "force-dynamic";

const rand = (c: number) => (c / 100).toFixed(2);

/**
 * Fulfilment: how customers receive orders (collection / delivery), who
 * delivers (own drivers / Skhokholetha / both), how delivery is priced
 * (flat / distance / by area) and the delivery areas themselves. Everything
 * here is enforced server-side by the quote engine and the delivery services.
 */
export default async function FulfilmentPage({ searchParams }: { searchParams: Promise<{ saved?: string; err?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;
  let permitted = true;
  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    permitted = false;
  }
  const business = await prisma.business.findUniqueOrThrow({ where: { id: session.tenantId }, select: { settings: true, latitude: true, longitude: true } });
  const delivery = getDeliverySettings(business);
  const fulfilment = getFulfilmentSettings(business);
  const zones = await listZones(session.tenantId);
  const hasPin = business.latitude !== null && business.longitude !== null;
  const networkAvailable = lethaEnabled("network");

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Collection & delivery</h1>
        <DashboardNav current="settings" {...workspaceContext} />
        {sp.saved && <div className="successBanner">Saved.</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        {!permitted ? (
          <div className={`card ${styles.section}`}>
            <p>Only someone with settings permission can change fulfilment — ask the business owner.</p>
          </div>
        ) : (
          <>
            <form action={updateFulfilmentAction} className={styles.form}>
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>How customers get their order</h2>
                <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                  <input type="checkbox" name="collectionEnabled" defaultChecked={fulfilment.collectionEnabled} /> Collection — customers fetch it from you
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                  <input type="checkbox" name="deliveryEnabled" defaultChecked={delivery.enabled} /> Delivery — you (or Skhokholetha) bring it to them
                </label>
                <p className={styles.sub}>Switch both off and your storefront stops taking orders. Orders already placed are not affected.</p>
              </section>

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Who delivers</h2>
                {(["OWN", "BOTH", "NETWORK"] as const).map((v) => (
                  <label key={v} style={{ display: "flex", gap: 8, alignItems: "flex-start", minHeight: 44 }}>
                    <input type="radio" name="deliverySources" value={v} defaultChecked={fulfilment.deliverySources === v} style={{ marginTop: 6 }} />
                    <span>
                      {v === "OWN" && <><strong>My own drivers only</strong> — staff with the Driver role.</>}
                      {v === "BOTH" && <><strong>My drivers first, Skhokholetha when I need extra hands</strong>.</>}
                      {v === "NETWORK" && <><strong>Skhokholetha drivers only</strong> — you request a driver per order.</>}
                    </span>
                  </label>
                ))}
                {!networkAvailable && <p className={styles.sub}>Skhokholetha isn&apos;t live on this platform yet — choosing it now is fine; requests become available when it switches on.</p>}
              </section>

              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Delivery price</h2>
                <p className={styles.sub}>Customers always see one exact fee before they pay.</p>
                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}>
                    <input type="radio" name="pricingMode" value="FLAT" defaultChecked={delivery.pricingMode === "FLAT"} /> One flat fee
                  </label>
                  <div className="field" style={{ paddingLeft: 26 }}>
                    <label className="label" htmlFor="flatFee">Flat fee (R)</label>
                    <input className="input" id="flatFee" name="flatFee" inputMode="decimal" defaultValue={rand(delivery.feeCents)} style={{ maxWidth: 160 }} />
                  </div>

                  <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}>
                    <input type="radio" name="pricingMode" value="ZONE" defaultChecked={delivery.pricingMode === "ZONE"} /> By area — a fixed fee per area (set up below)
                  </label>

                  <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}>
                    <input type="radio" name="pricingMode" value="PER_KM" defaultChecked={delivery.pricingMode === "PER_KM"} /> By distance
                  </label>
                  <div style={{ display: "grid", gap: 8, paddingLeft: 26, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                    <div className="field"><label className="label" htmlFor="baseFee">Base fee (R)</label><input className="input" id="baseFee" name="baseFee" inputMode="decimal" defaultValue={rand(delivery.baseFeeCents)} /></div>
                    <div className="field"><label className="label" htmlFor="perKmFee">Per km (R)</label><input className="input" id="perKmFee" name="perKmFee" inputMode="decimal" defaultValue={rand(delivery.perKmFeeCents)} /></div>
                    <div className="field"><label className="label" htmlFor="minFee">Minimum fee (R)</label><input className="input" id="minFee" name="minFee" inputMode="decimal" defaultValue={rand(delivery.minFeeCents)} /></div>
                    <div className="field"><label className="label" htmlFor="maxDistanceKm">Max distance (km, 0 = no limit)</label><input className="input" id="maxDistanceKm" name="maxDistanceKm" inputMode="decimal" defaultValue={String(delivery.maxDistanceKm)} /></div>
                  </div>
                  {!hasPin && <p className={styles.sub} style={{ paddingLeft: 26 }}>Distance pricing needs your shop&apos;s location — save your address in Business settings first.</p>}
                </div>
                <div className="field" style={{ marginTop: 10 }}>
                  <label className="label" htmlFor="areaInfo">A note customers see at checkout (optional)</label>
                  <input className="input" id="areaInfo" name="areaInfo" maxLength={300} defaultValue={delivery.areaInfo ?? ""} placeholder="e.g. Deliveries go out every 30 minutes." />
                </div>
              </section>

              <button type="submit" className="btn btnPrimary btnBlock" style={{ minHeight: 44 }}>Save fulfilment settings</button>
            </form>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Delivery areas</h2>
              <p className={styles.sub}>
                Used when pricing is <strong>by area</strong>. Customers pick their area at checkout and pay exactly this fee. Add suburb names to pre-select the right area from the address they type.
              </p>
              {zones.length === 0 && <p className={styles.sub}>No areas yet.</p>}
              <div style={{ display: "grid", gap: 10 }}>
                {zones.map((z, i) => (
                  <details key={z.id} className="card" style={{ padding: 12 }}>
                    <summary style={{ display: "flex", justifyContent: "space-between", gap: 8, cursor: "pointer", minHeight: 32, alignItems: "center" }}>
                      <span>
                        <strong>{z.name}</strong> · {formatCents(z.feeCents)}
                        {z.minOrderCents ? ` · min order ${formatCents(z.minOrderCents)}` : ""}
                        {!z.active && <span style={{ opacity: 0.7 }}> · hidden</span>}
                      </span>
                      <span style={{ opacity: 0.7 }}>edit</span>
                    </summary>
                    <form action={saveZoneAction.bind(null, z.id)} style={{ display: "grid", gap: 8, marginTop: 10 }}>
                      <input type="hidden" name="priority" value={z.priority} />
                      <input type="hidden" name="active" value={z.active ? "on" : "off"} />
                      <div className="field"><label className="label" htmlFor={`n-${z.id}`}>Area name</label><input className="input" id={`n-${z.id}`} name="name" defaultValue={z.name} required maxLength={60} /></div>
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                        <div className="field"><label className="label" htmlFor={`f-${z.id}`}>Fee (R)</label><input className="input" id={`f-${z.id}`} name="fee" inputMode="decimal" defaultValue={rand(z.feeCents)} required /></div>
                        <div className="field"><label className="label" htmlFor={`m-${z.id}`}>Minimum order (R, optional)</label><input className="input" id={`m-${z.id}`} name="minOrder" inputMode="decimal" defaultValue={z.minOrderCents ? rand(z.minOrderCents) : ""} /></div>
                      </div>
                      <div className="field">
                        <label className="label" htmlFor={`k-${z.id}`}>How it&apos;s matched</label>
                        <select className="input" id={`k-${z.id}`} name="matchKind" defaultValue={z.matchKind}>
                          <option value="CUSTOMER_PICK">Customer picks this area</option>
                          <option value="SUBURB_LIST">Customer picks, and suburbs below pre-select it</option>
                        </select>
                      </div>
                      <div className="field"><label className="label" htmlFor={`s-${z.id}`}>Suburbs (comma separated)</label><input className="input" id={`s-${z.id}`} name="suburbs" defaultValue={z.suburbs.join(", ")} /></div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="submit" className="btn btnPrimary" style={{ minHeight: 44 }}>Save</button>
                      </div>
                    </form>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <form action={toggleZoneAction.bind(null, z.id, !z.active)}><button type="submit" className="btn" style={{ minHeight: 44 }}>{z.active ? "Hide" : "Show"}</button></form>
                      {i > 0 && <form action={moveZoneAction.bind(null, z.id, "UP")}><button type="submit" className="btn" style={{ minHeight: 44 }}>↑ Up</button></form>}
                      {i < zones.length - 1 && <form action={moveZoneAction.bind(null, z.id, "DOWN")}><button type="submit" className="btn" style={{ minHeight: 44 }}>↓ Down</button></form>}
                      <form action={deleteZoneAction.bind(null, z.id)}><button type="submit" className="btn" style={{ minHeight: 44 }}>Delete</button></form>
                    </div>
                  </details>
                ))}
              </div>

              <details className="card" style={{ padding: 12, marginTop: 12 }}>
                <summary style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center" }}>+ Add an area</summary>
                <form action={addZoneAction} style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <div className="field"><label className="label" htmlFor="new-name">Area name</label><input className="input" id="new-name" name="name" required maxLength={60} placeholder="e.g. the suburb or part of town" /></div>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                    <div className="field"><label className="label" htmlFor="new-fee">Fee (R)</label><input className="input" id="new-fee" name="fee" inputMode="decimal" required placeholder="25" /></div>
                    <div className="field"><label className="label" htmlFor="new-min">Minimum order (R, optional)</label><input className="input" id="new-min" name="minOrder" inputMode="decimal" /></div>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="new-kind">How it&apos;s matched</label>
                    <select className="input" id="new-kind" name="matchKind" defaultValue="CUSTOMER_PICK">
                      <option value="CUSTOMER_PICK">Customer picks this area</option>
                      <option value="SUBURB_LIST">Customer picks, and suburbs below pre-select it</option>
                    </select>
                  </div>
                  <div className="field"><label className="label" htmlFor="new-suburbs">Suburbs (comma separated, optional)</label><input className="input" id="new-suburbs" name="suburbs" /></div>
                  <button type="submit" className="btn btnPrimary" style={{ minHeight: 44 }}>Add area</button>
                </form>
              </details>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>What customers will see</h2>
              {!delivery.enabled ? (
                <p>Delivery: not offered.{fulfilment.collectionEnabled ? " Collection: available." : ""}</p>
              ) : delivery.pricingMode === "ZONE" ? (
                zones.filter((z) => z.active).length === 0 ? (
                  <p className="errorBanner">Pricing is by area but you have no visible areas — customers can&apos;t choose delivery until you add one.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      {zones.filter((z) => z.active).map((z) => (
                        <tr key={z.id}>
                          <td style={{ padding: "6px 0", borderBottom: "1px solid var(--edge)" }}>{z.name}</td>
                          <td style={{ padding: "6px 0", borderBottom: "1px solid var(--edge)", textAlign: "right" }}>{formatCents(z.feeCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : delivery.pricingMode === "PER_KM" ? (
                <p>
                  Delivery from {formatCents(Math.max(delivery.minFeeCents, delivery.baseFeeCents))}: {formatCents(delivery.baseFeeCents)} + {formatCents(delivery.perKmFeeCents)} per km
                  {delivery.maxDistanceKm > 0 ? `, up to ${delivery.maxDistanceKm} km` : ""}.
                </p>
              ) : (
                <p>Delivery {formatCents(delivery.feeCents)} flat.{fulfilment.collectionEnabled ? " Collection: available." : ""}</p>
              )}
            </section>
          </>
        )}

        <p>
          <Link href="/dashboard/settings">← Business settings</Link>
        </p>
      </div>
    </main>
  );
}
