import Link from "next/link";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { can } from "@/modules/platform-admin/permissions";
import { prisma } from "@/lib/prisma/client";
import { listPayouts } from "@/modules/skhokholetha/ledger.service";
import { formatCents } from "@/lib/utils";
import { Banner, PageHeader, ReasonField, Section, Stats, Table, when } from "../ui";
import { settlePayoutAction } from "../drivers/actions";

export const dynamic = "force-dynamic";

/**
 * Driver payouts — manual in V1: pay by EFT, then record the bank reference
 * here (or mark it failed, which releases the earnings for the next payout).
 * Balances are sums of the append-only ledger; nothing here edits a balance.
 */
export default async function PayoutsAdminPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await adminPage("payouts.view");
  const sp = await searchParams;
  const [payouts, byStatus, inPayout, adjustments] = await Promise.all([
    listPayouts(),
    prisma.driverLedgerEntry.groupBy({ by: ["status"], where: { payoutId: null }, _sum: { amountCents: true } }),
    prisma.driverLedgerEntry.aggregate({ where: { payoutId: { not: null }, status: "AVAILABLE" }, _sum: { amountCents: true } }),
    prisma.driverLedgerEntry.findMany({
      where: { type: "ADJUSTMENT" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, amountCents: true, reason: true, reference: true, createdBy: true, createdAt: true, driver: { select: { id: true, displayName: true } } },
    }),
  ]);
  const sum = (s: string) => byStatus.find((r) => r.status === s)?._sum.amountCents ?? 0;
  const paid = await prisma.driverLedgerEntry.aggregate({ where: { status: "PAID" }, _sum: { amountCents: true } });
  const canPay = can(admin.role, "payouts.manage");

  return (
    <>
      <PageHeader title="Payouts" sub="Skhokholetha driver earnings. Manual EFT; every change is a ledger entry or a payout record." />
      <Banner ok={sp.ok} err={sp.err} />
      <Stats
        items={[
          { label: "Pending (24h hold)", value: formatCents(sum("PENDING")) },
          { label: "Available to pay", value: formatCents(sum("AVAILABLE")) },
          { label: "In a payout", value: formatCents(inPayout._sum.amountCents ?? 0) },
          { label: "Paid (all time)", value: formatCents(paid._sum.amountCents ?? 0) },
        ]}
      />

      <Section title="Payouts">
        <Table
          head={["Driver", "Amount", "Bank", "Status", "Reference", "Created", "Paid", ""]}
          rows={payouts.map((p) => [
            <Link key="d" href={`/platform-admin/drivers/${p.driver.id}`}>{p.driver.displayName}</Link>,
            formatCents(p.amountCents),
            `${p.driver.payoutBankName ?? "—"} …${p.driver.payoutAccountLast4 ?? "—"}`,
            p.status.toLowerCase(),
            p.reference ?? "",
            when(p.createdAt),
            when(p.paidAt),
            canPay && p.status === "REQUESTED" ? (
              <div key="a" style={{ display: "grid", gap: 6 }}>
                <form action={settlePayoutAction.bind(null, p.id, "PAID")} style={{ display: "flex", gap: 6 }}>
                  <input className="input" name="reference" placeholder="Bank payment reference" required maxLength={100} />
                  <button type="submit" className="btn btnPrimary">Mark paid</button>
                </form>
                <form action={settlePayoutAction.bind(null, p.id, "FAILED")} style={{ display: "flex", gap: 6 }}>
                  <ReasonField placeholder="What went wrong" />
                  <button type="submit" className="btn">Mark failed</button>
                </form>
              </div>
            ) : (
              ""
            ),
          ])}
          empty="No payouts yet. Create one from a driver's page."
        />
      </Section>

      <Section title="Recent ledger adjustments">
        <Table
          head={["When", "Driver", "Amount", "Reason", "Reference", "By (admin id)"]}
          rows={adjustments.map((a) => [when(a.createdAt), <Link key="d" href={`/platform-admin/drivers/${a.driver.id}`}>{a.driver.displayName}</Link>, formatCents(a.amountCents), a.reason ?? "", a.reference ?? "", a.createdBy ?? ""])}
          empty="No adjustments."
        />
      </Section>
    </>
  );
}
