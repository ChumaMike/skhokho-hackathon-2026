import { adminPage } from "@/modules/platform-admin/page-guard";
import { can } from "@/modules/platform-admin/permissions";
import { prisma } from "@/lib/prisma/client";
import { formatCents } from "@/lib/utils";
import { vatMode, invoiceIssuingEnabled } from "@/modules/billing/vat";
import { bankDetails, ISSUER_DISPLAY } from "@/modules/billing/issuer";
import { Banner, PageHeader, ReasonField, Section, Stats, Table, when } from "../ui";
import {
  createDraftInvoiceAction,
  issueInvoiceAction,
  recordSettlementAction,
  voidInvoiceAction,
  writeOffInvoiceAction,
  compPlanAction,
  startTrialAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Control Centre > Billing — merchants paying Skhokho Laboratory.
 *
 * Deliberately NOT the same screen as "Payments" (a merchant's own customers
 * paying them, into the merchant's own PayFast account) or "Payouts" (driver
 * earnings). Three money streams, three screens, and no figure on this page
 * is ever summed with a figure from those.
 *
 * Phase A takes no card: settlement is a human recording money that arrived,
 * normally by EFT. Everything that changes state needs `billing.manage`,
 * which only FINANCE and SUPER_ADMIN hold.
 */
export default async function BillingAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const admin = await adminPage("billing.view");
  const sp = await searchParams;
  const canManage = can(admin.role, "billing.manage");
  const now = new Date();

  const [byStatus, overdue, recent, subscriptions, requests, trialing] = await Promise.all([
    prisma.platformInvoice.groupBy({ by: ["status"], _sum: { totalCents: true }, _count: { _all: true } }),
    prisma.platformInvoice.findMany({
      where: { status: "OPEN", dueAt: { lt: now } },
      orderBy: { dueAt: "asc" },
      take: 50,
      select: {
        id: true,
        number: true,
        totalCents: true,
        dueAt: true,
        lastNoticeStage: true,
        business: { select: { id: true, name: true } },
      },
    }),
    prisma.platformInvoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        number: true,
        status: true,
        totalCents: true,
        periodStart: true,
        dueAt: true,
        paidAt: true,
        business: { select: { id: true, name: true } },
      },
    }),
    prisma.businessSubscription.findMany({
      where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELLED"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        businessId: true,
        status: true,
        currentPeriodEnd: true,
        graceEndsAt: true,
        billingEmail: true,
        planRef: { select: { code: true, name: true, priceCents: true } },
        business: { select: { name: true } },
      },
    }),
    // Plan-change requests are audit events, not a table: Phase A sells
    // nothing self-service, so a request is something a person follows up.
    prisma.platformAuditEvent.findMany({
      where: { action: "platform_plan_change_requested" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, businessId: true, resourceId: true, reason: true, createdAt: true },
    }),
    prisma.businessSubscription.count({ where: { status: "TRIALING" } }),
  ]);

  const stat = (s: string) => byStatus.find((r) => r.status === s);
  const openSum = stat("OPEN")?._sum.totalCents ?? 0;
  const paidSum = stat("PAID")?._sum.totalCents ?? 0;
  const writtenOff = stat("UNCOLLECTIBLE")?._sum.totalCents ?? 0;
  const overdueSum = overdue.reduce((s, i) => s + i.totalCents, 0);

  const mode = vatMode();
  const issuing = invoiceIssuingEnabled();
  const bank = bankDetails();

  // Business names for the audit-sourced request list.
  const requestBusinessIds = [...new Set(requests.map((r) => r.businessId).filter((v): v is string => !!v))];
  const requestBusinesses = requestBusinessIds.length
    ? await prisma.business.findMany({
        where: { id: { in: requestBusinessIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(requestBusinesses.map((b) => [b.id, b.name]));

  return (
    <>
      <PageHeader
        title="Billing"
        sub={`Merchants paying ${ISSUER_DISPLAY}. Separate from Payments (their own customers) and Payouts (drivers).`}
      />
      <Banner ok={sp.ok} err={sp.err} />

      {/* Configuration state, stated plainly — these decide whether a real
          invoice may be issued at all. */}
      {!issuing && (
        <div className="errorBanner">
          Invoices are not being issued: the VAT status of Skhokho Laboratory is not confirmed. Drafts
          work; issuing is blocked until <code>BILLING_TAX_STATUS_CONFIRMED=true</code>.
        </div>
      )}
      {!mode.registered && (
        <div className="successBanner">
          Not VAT registered: invoices render as &ldquo;Invoice&rdquo;, with no VAT line and no VAT
          number. Set <code>BILLING_VAT_NUMBER</code> to switch to VAT-inclusive tax invoices.
        </div>
      )}
      {!bank && (
        <div className="errorBanner">
          No bank details configured, so invoices cannot show where to pay. Set the{" "}
          <code>BILLING_BANK_*</code> variables.
        </div>
      )}

      <Stats
        items={[
          { label: "Awaiting payment", value: formatCents(openSum), tone: openSum > 0 ? "warn" : undefined },
          { label: "Overdue", value: formatCents(overdueSum), tone: overdueSum > 0 ? "bad" : undefined },
          { label: "Collected (all time)", value: formatCents(paidSum), tone: "ok" },
          { label: "Written off", value: formatCents(writtenOff) },
          { label: "On trial", value: String(trialing) },
        ]}
      />

      <Section title="Overdue">
        <Table
          head={["Business", "Invoice", "Amount", "Due", "Last notice", canManage ? "Record payment" : "—"]}
          empty="Nothing overdue."
          rows={overdue.map((inv) => [
            inv.business.name,
            inv.number ?? "—",
            formatCents(inv.totalCents),
            when(inv.dueAt),
            inv.lastNoticeStage ?? "none yet",
            canManage ? (
              <form action={recordSettlementAction} key={inv.id}>
                <input type="hidden" name="invoiceId" value={inv.id} />
                <input type="hidden" name="amountCents" value={inv.totalCents} />
                <input type="hidden" name="method" value="EFT" />
                <input
                  className="input"
                  name="payerReference"
                  placeholder="Their EFT reference"
                  maxLength={140}
                />
                <button type="submit" className="btn btnSecondary">
                  Mark paid by EFT
                </button>
              </form>
            ) : (
              "—"
            ),
          ])}
        />
      </Section>

      <Section title="Recent invoices">
        <Table
          head={["Business", "Invoice", "Status", "Amount", "Period from", "Paid", canManage ? "Actions" : "—"]}
          empty="No invoices yet."
          rows={recent.map((inv) => [
            inv.business.name,
            inv.number ?? <em>draft</em>,
            inv.status,
            formatCents(inv.totalCents),
            when(inv.periodStart),
            when(inv.paidAt),
            canManage ? (
              <div key={inv.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {inv.status === "DRAFT" && (
                  <form action={issueInvoiceAction}>
                    <input type="hidden" name="invoiceId" value={inv.id} />
                    <button type="submit" className="btn btnSecondary">
                      Issue
                    </button>
                  </form>
                )}
                {inv.status === "OPEN" && (
                  <>
                    <form action={writeOffInvoiceAction}>
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <ReasonField placeholder="Why write it off?" />
                      <button type="submit" className="btn btnGhost">
                        Write off
                      </button>
                    </form>
                    <form action={voidInvoiceAction}>
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <ReasonField placeholder="Why cancel it?" />
                      <button type="submit" className="btn btnGhost">
                        Cancel
                      </button>
                    </form>
                  </>
                )}
                {inv.status !== "DRAFT" && inv.status !== "OPEN" && "—"}
              </div>
            ) : (
              "—"
            ),
          ])}
        />
      </Section>

      <Section title="Subscriptions">
        <Table
          head={["Business", "Plan", "Price", "Status", "Runs until", "Grace ends", "Billing email", canManage ? "Invoice" : "—"]}
          empty="No subscriptions yet."
          rows={subscriptions.map((s) => [
            s.business.name,
            s.planRef?.name ?? "Free",
            s.planRef?.priceCents != null ? formatCents(s.planRef.priceCents) : "—",
            s.status,
            when(s.currentPeriodEnd),
            when(s.graceEndsAt),
            s.billingEmail ?? "—",
            canManage ? (
              <form action={createDraftInvoiceAction} key={s.businessId}>
                <input type="hidden" name="businessId" value={s.businessId} />
                <button type="submit" className="btn btnSecondary">
                  Draft next invoice
                </button>
              </form>
            ) : (
              "—"
            ),
          ])}
        />
      </Section>

      <Section title="Plan change requests">
        <Table
          head={["Business", "Wants", "Note", "When"]}
          empty="No requests."
          rows={requests.map((r) => [
            (r.businessId && nameOf.get(r.businessId)) ?? r.businessId ?? "—",
            r.resourceId ?? "—",
            r.reason ?? "—",
            when(r.createdAt),
          ])}
        />
      </Section>

      {canManage && (
        <Section title="Comp or extend a plan">
          <p className="muted">
            Puts a business on a plan without payment — a pilot, a goodwill fix, a delayed invoice. It
            moves the subscription only, never what a plan grants, and it expires on its own.
          </p>
          <form action={compPlanAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input className="input" name="businessId" placeholder="Business id (UUID)" required />
            <select className="input" name="planCode" defaultValue="GROW" aria-label="Plan">
              <option value="FREE">Free</option>
              <option value="GROW">Grow</option>
              <option value="PRO">Pro</option>
            </select>
            <input
              className="input"
              name="months"
              type="number"
              min={1}
              max={24}
              defaultValue={1}
              aria-label="Months"
              required
            />
            <ReasonField placeholder="Why is this comped? (audit log)" />
            <button type="submit" className="btn btnPrimary">
              Apply
            </button>
          </form>
        </Section>
      )}

      {canManage && (
        <Section title="Start a 14-day Grow trial">
          <p className="muted">
            For a business that registered before trials existed. No card, and it falls back to Free
            on its own — nothing is deleted.
          </p>
          <form action={startTrialAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input className="input" name="businessId" placeholder="Business id (UUID)" required />
            <button type="submit" className="btn btnSecondary">
              Start trial
            </button>
          </form>
        </Section>
      )}
    </>
  );
}
