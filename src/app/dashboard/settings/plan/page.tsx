import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import DashboardNav from "@/components/DashboardNav";
import ConfirmActionButton from "@/components/ConfirmActionButton";
import { formatZAR } from "@/lib/utils";
import { prisma } from "@/lib/prisma/client";
import { getBusinessEntitlements, listPublicPlans } from "@/modules/billing/subscription.service";
import { limitUsage } from "@/modules/billing/limits";
import { listInvoicesForBusiness, amountOutstanding } from "@/modules/billing/invoice.service";
import { FEATURES, type FeatureKey } from "@/modules/billing/features";
import { requestPlanChangeAction, cancelSubscriptionAction, updateBillingEmailAction } from "./actions";
import styles from "./plan.module.css";

export const dynamic = "force-dynamic";

/**
 * Dashboard > Settings > Your plan.
 *
 * Gated on canManageBilling, which no staff preset grants — so in practice
 * only the business owner sees it. What a business pays Skhokho Laboratory is
 * not a cashier's concern.
 *
 * Phase A sells nothing from this page: there is no card on file and no
 * checkout. Upgrading is a REQUEST a real person follows up, which is honest
 * about what the product can do today rather than a button that pretends to
 * charge. Cancelling is real and immediate in effect.
 */

const STATE_COPY: Record<string, string> = {
  NO_SUBSCRIPTION: "You're on the Free plan.",
  ACTIVE: "Active.",
  TRIALING: "Free trial running.",
  GRACE: "Payment outstanding — everything still works for now.",
  CANCELLED_PENDING: "Cancelled — you keep this plan until the end of the period.",
  EXPIRED: "Back on the Free plan.",
  UNCONFIGURED: "We can't read your plan right now.",
};

const INVOICE_STATUS_COPY: Record<string, string> = {
  OPEN: "Awaiting payment",
  PAID: "Paid",
  UNCOLLECTIBLE: "Unpaid",
  VOID: "Cancelled",
};

function dateLabel(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);

  // A session already exists; what matters here is whether this person may see
  // and change what the business pays Skhokho Laboratory.
  let permitted = true;
  try {
    await requireStaffPermission("canManageBilling");
  } catch {
    permitted = false;
  }

  const entitlements = permitted ? await getBusinessEntitlements(session.tenantId) : null;
  const [usage, plans, invoices, outstanding, subscription] = permitted
    ? await Promise.all([
        limitUsage(session.tenantId, entitlements ?? undefined),
        listPublicPlans(),
        listInvoicesForBusiness(session.tenantId),
        amountOutstanding(session.tenantId),
        prisma.businessSubscription.findUnique({
          where: { businessId: session.tenantId },
          select: { status: true, currentPeriodEnd: true, billingEmail: true },
        }),
      ])
    : [[], [], [], 0, null as Awaited<ReturnType<typeof prisma.businessSubscription.findUnique>>];

  const included = entitlements
    ? (Object.keys(FEATURES) as FeatureKey[]).filter(
        (k) => FEATURES[k].kind === "boolean" && entitlements.features[k].enabled,
      )
    : [];
  const canCancel =
    subscription != null &&
    (subscription.status === "ACTIVE" ||
      subscription.status === "PAST_DUE" ||
      subscription.status === "TRIALING");

  return (
    <div className="shell">
      <div className="consoleChrome">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Your plan</h1>
        <p className={styles.sub}>
          What your business pays Skhokho Laboratory. Your customers&apos; payments are separate and
          go straight into your own account.
        </p>

        <DashboardNav current="settings" {...workspaceContext} />
        <p className={styles.sub}>
          <Link href="/dashboard/settings">← Back to settings</Link>
        </p>
      </div>

      <div className="consoleCanvas">
        {sp.ok && <div className="successBanner">{sp.ok}</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        {!permitted || !entitlements ? (
          <section className={styles.card}>
            <p className={styles.note}>
              Only the business owner can see and change the plan. Ask them if you need something
              switched on.
            </p>
          </section>
        ) : (
          <>
            {/* --- Where you are --- */}
            <section className={styles.card}>
              <div className={styles.planHead}>
                <div>
                  <p className={styles.eyebrow}>Current plan</p>
                  <h2 className={styles.planName}>{entitlements.planName ?? "Free"}</h2>
                  <p className={styles.note}>{STATE_COPY[entitlements.state] ?? entitlements.state}</p>
                </div>
                {entitlements.accessUntil && (
                  <p className={styles.until}>
                    {entitlements.state === "TRIALING" ? "Trial ends" : "Runs until"}{" "}
                    <strong>{dateLabel(entitlements.accessUntil)}</strong>
                  </p>
                )}
              </div>

              {entitlements.state === "GRACE" && (
                <p className={styles.warn}>
                  We haven&apos;t received your last payment yet. Everything keeps working until{" "}
                  <strong>{dateLabel(entitlements.accessUntil)}</strong>. After that your account
                  moves to Free — nothing gets deleted, and your shop keeps trading either way.
                </p>
              )}

              {outstanding > 0 && (
                <p className={styles.warn}>
                  Outstanding: <strong>{formatZAR(outstanding / 100)}</strong>. Pay by EFT using the
                  invoice number as your reference.
                </p>
              )}

              {included.length > 0 && (
                <ul className={styles.featureList}>
                  {included.map((k) => (
                    <li key={k}>{FEATURES[k].label}</li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- Usage against limits --- */}
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>What you&apos;re using</h2>
              <ul className={styles.usageList}>
                {usage.map((u) => (
                  <li key={u.feature} className={styles.usageRow} data-over={u.overLimit || undefined}>
                    <span className={styles.usageLabel}>{u.label}</span>
                    <span className={styles.usageValue}>
                      {u.used} {u.limit === null ? "(no limit)" : `of ${u.limit}`}
                    </span>
                  </li>
                ))}
              </ul>
              {usage.some((u) => u.overLimit) && (
                <p className={styles.warn}>
                  You have more than your plan includes. <strong>Nothing has been removed</strong> —
                  it all still works. You just can&apos;t add more until you move up a plan.
                </p>
              )}
              {usage.some((u) => u.atLimit && !u.overLimit) && (
                <p className={styles.note}>
                  You&apos;re at your limit on one or more of these. Moving up a plan lifts it.
                </p>
              )}
            </section>

            {/* --- Other plans --- */}
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>Other plans</h2>
              <p className={styles.note}>
                Tell us which one you want and we&apos;ll set it up and invoice you. You pay by EFT —
                no card needed.
              </p>
              <div className={styles.planGrid}>
                {plans
                  .filter((p) => p.code !== entitlements.planCode)
                  .map((p) => (
                    <form key={p.code} action={requestPlanChangeAction} className={styles.planOption}>
                      <input type="hidden" name="planCode" value={p.code} />
                      <h3 className={styles.planOptionName}>{p.name}</h3>
                      <p className={styles.planPrice}>
                        {p.priceCents === null
                          ? "Pricing coming soon"
                          : p.priceCents === 0
                            ? "Free"
                            : `${formatZAR(p.priceCents / 100)} / month`}
                      </p>
                      {p.tagline && <p className={styles.note}>{p.tagline}</p>}
                      <button
                        type="submit"
                        className="btn btnSecondary"
                        disabled={p.priceCents === null}
                      >
                        {p.priceCents === null ? "Not available yet" : `Ask about ${p.name}`}
                      </button>
                    </form>
                  ))}
              </div>
            </section>

            {/* --- Invoices --- */}
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>Invoices</h2>
              {invoices.length === 0 ? (
                <p className={styles.note}>No invoices yet.</p>
              ) : (
                <ul className={styles.invoiceList}>
                  {invoices.map((inv) => (
                    <li key={inv.id} className={styles.invoiceRow}>
                      <div>
                        <Link
                          href={`/dashboard/settings/plan/invoices/${inv.id}`}
                          className={styles.invoiceNumber}
                        >
                          {inv.number ?? "—"}
                        </Link>
                        <span className={styles.invoiceMeta}>
                          {dateLabel(inv.periodStart)} — {dateLabel(inv.periodEnd)}
                        </span>
                      </div>
                      <div className={styles.invoiceRight}>
                        <span className={styles.invoiceTotal}>{formatZAR(inv.totalCents / 100)}</span>
                        <span className={styles.invoiceStatus} data-status={inv.status}>
                          {INVOICE_STATUS_COPY[inv.status] ?? inv.status}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- Billing email --- */}
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>Where invoices go</h2>
              <form action={updateBillingEmailAction} className={styles.inlineForm}>
                <label className="label" htmlFor="billingEmail">
                  Billing email
                </label>
                <input
                  id="billingEmail"
                  name="billingEmail"
                  type="email"
                  className="input"
                  defaultValue={subscription?.billingEmail ?? ""}
                  placeholder="you@yourbusiness.co.za"
                  required
                />
                <p className={styles.note}>
                  Invoices and reminders go here. Handy if your bookkeeper handles the money.
                </p>
                <button type="submit" className="btn btnSecondary">
                  Save
                </button>
              </form>
            </section>

            {/* --- Cancel --- */}
            {canCancel && (
              <section className={styles.card}>
                <h2 className={styles.sectionTitle}>Cancel your plan</h2>
                <p className={styles.note}>
                  You keep everything you&apos;ve paid for until{" "}
                  <strong>{dateLabel(subscription?.currentPeriodEnd ?? null)}</strong>, then you move
                  to Free. Your shop, orders, products, staff and customers all stay — nothing is
                  deleted.
                </p>
                <ConfirmActionButton
                  action={cancelSubscriptionAction}
                  label="Cancel my plan"
                  confirmLabel="Yes, cancel it"
                  className="btn btnGhost"
                />
              </section>
            )}

            <p className={styles.issuer}>
              Billing is by Skhokho Laboratory (&ldquo;Skhokho Labs&rdquo;). Your customers&apos;
              payments are separate and settle straight into your own account —{" "}
              <Link href="/dashboard/settings/payments">see Get paid online</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
