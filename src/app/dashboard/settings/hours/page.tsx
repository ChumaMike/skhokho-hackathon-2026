import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { hasConfiguredHours, hoursForEditor, defaultOperatingHours, WEEKDAY_KEYS, WEEKDAY_LABELS } from "@/modules/tenant/operating-hours";
import { getTradingStatus } from "@/modules/tenant/trading-status";
import DashboardNav from "@/components/DashboardNav";
import PauseOrdersControl from "./PauseOrdersControl";
import { updateOperatingHours } from "./actions";
import styles from "../settings.module.css";

export const dynamic = "force-dynamic";

/** Opening hours (weekly) and the "pause orders now" switch — the two things that decide whether checkout is open. */
export default async function HoursPage({ searchParams }: { searchParams: Promise<{ saved?: string; err?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;
  let canEditHours = true;
  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    canEditHours = false;
  }
  const canPause = workspaceContext.isOwner || workspaceContext.permissions.canManageOrders;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: session.tenantId }, select: { settings: true, operatingHours: true } });
  const trading = getTradingStatus(business);
  const configured = hasConfiguredHours(business.operatingHours);
  const hours = configured ? hoursForEditor(business.operatingHours) : defaultOperatingHours();

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Opening hours</h1>
        <DashboardNav current="settings" {...workspaceContext} />
        {sp.saved && <div className="successBanner">Saved.</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Right now</h2>
          <p className={styles.sub}>Customers see this on your storefront, and checkout follows it.</p>
          {canPause ? <PauseOrdersControl trading={trading} returnTo="/dashboard/settings/hours" /> : <p>{trading.label}</p>}
          <p className={styles.sub} style={{ marginTop: 8 }}>
            Pausing stops new orders for a short while (up to 24 hours) without changing your weekly hours — handy when the kitchen is slammed or you run out of stock.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Weekly hours</h2>
          {!configured && <p className={styles.sub}>You haven&apos;t set hours yet, so your shop counts as open all the time. Save your real hours below.</p>}
          {!canEditHours ? (
            <p>Only someone with settings permission can change opening hours — ask the business owner.</p>
          ) : (
            <form action={updateOperatingHours} className={styles.form}>
              <div style={{ display: "grid", gap: 10 }}>
                {WEEKDAY_KEYS.map((day) => {
                  const d = hours[day];
                  const closed = "closed" in d && d.closed === true;
                  return (
                    <fieldset key={day} style={{ border: "1px solid var(--edge)", borderRadius: 10, padding: 10, display: "grid", gap: 8 }}>
                      <legend style={{ fontWeight: 600, padding: "0 6px" }}>{WEEKDAY_LABELS[day]}</legend>
                      <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 32 }}>
                        <input type="checkbox" name={`${day}-closed`} defaultChecked={closed} /> Closed
                      </label>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <label className="label" htmlFor={`${day}-open`}>Open</label>
                        <input className="input" id={`${day}-open`} name={`${day}-open`} type="time" step={300} defaultValue={closed ? "09:00" : (d as { open: string }).open} style={{ maxWidth: 140 }} />
                        <label className="label" htmlFor={`${day}-close`}>Close</label>
                        <input className="input" id={`${day}-close`} name={`${day}-close`} type="time" step={300} defaultValue={closed ? "17:00" : (d as { close: string }).close} style={{ maxWidth: 140 }} />
                      </div>
                    </fieldset>
                  );
                })}
              </div>
              <p className={styles.sub}>Times are South African time. For a late shop, a closing time earlier than the opening time (e.g. 18:00 to 02:00) means you close after midnight.</p>
              <button type="submit" className="btn btnPrimary btnBlock" style={{ minHeight: 44 }}>Save hours</button>
            </form>
          )}
        </section>

        <p>
          <Link href="/dashboard/settings">← Business settings</Link>
        </p>
      </div>
    </main>
  );
}
