import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { can } from "@/modules/platform-admin/permissions";
import { prisma } from "@/lib/prisma/client";
import { DOCUMENT_LABELS, getDriverApplication, operatingEligibility, requiredDocuments } from "@/modules/skhokholetha/driver.service";
import { getDriverBalance } from "@/modules/skhokholetha/ledger.service";
import { driverLegalConfig } from "@/modules/skhokholetha/legal";
import { formatCents, formatSAPhone } from "@/lib/utils";
import { Badge, Banner, KV, PageHeader, ReasonField, Section, Stats, Table, when } from "../../ui";
import { adjustLedgerAction, createPayoutAction, decideDriverAction, reviewDocumentAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * One driver. Documents are visible (and downloadable) only with
 * drivers.documents; the bank account is always masked to its last 4 digits;
 * the phone number only with drivers.manage. Every decision needs a reason.
 */
export default async function DriverReviewPage({ params, searchParams }: { params: Promise<{ driverId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await adminPage("drivers.view");
  const { driverId } = await params;
  const sp = await searchParams;
  const d = await getDriverApplication(driverId);
  if (!d) notFound();
  const [balance, legalRows, deliveries, ledger, payouts, eligibilityRow] = await Promise.all([
    getDriverBalance(d.id),
    prisma.driverLegalAcceptance.findMany({ where: { driverId: d.id }, orderBy: { acceptedAt: "desc" }, select: { kind: true, version: true, acceptedAt: true } }),
    prisma.networkDelivery.findMany({
      where: { driverId: d.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, status: true, driverEarningCents: true, createdAt: true, endReason: true, business: { select: { name: true } } },
    }),
    prisma.driverLedgerEntry.findMany({ where: { driverId: d.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, type: true, status: true, amountCents: true, reason: true, reference: true, createdAt: true, payoutId: true } }),
    prisma.driverPayout.findMany({ where: { driverId: d.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, amountCents: true, status: true, reference: true, createdAt: true, paidAt: true } }),
    prisma.driverProfile.findUniqueOrThrow({
      where: { id: d.id },
      select: { verificationStatus: true, locationConsentAt: true, agreementVersion: true, agreementAcceptedAt: true, privacyVersion: true, privacyAcceptedAt: true, vehicles: { select: { type: true, isActive: true } }, documents: { select: { kind: true, status: true, expiresOn: true, uploadedAt: true } } },
    }),
  ]);
  const vehicle = d.vehicles.find((v) => v.isActive) ?? null;
  const required = requiredDocuments(vehicle?.type ?? null);
  const eligibility = operatingEligibility(eligibilityRow, eligibilityRow.vehicles, eligibilityRow.documents);
  const legal = driverLegalConfig();
  const incidents = deliveries.filter((x) => ["FAILED", "RETURNING", "RETURNED", "DISPUTED"].includes(x.status));
  const canManage = can(admin.role, "drivers.manage");
  const canDocs = can(admin.role, "drivers.documents");
  const canPay = can(admin.role, "payouts.manage");
  const phone = d.phone ? (canManage ? formatSAPhone(d.phone) : `…${d.phone.slice(-4)}`) : "—";

  return (
    <>
      <PageHeader title={d.displayName || "(no name yet)"} sub="Skhokholetha driver" />
      <Banner ok={sp.ok} err={sp.err} />

      <Section title="Driver">
        <KV
          items={[
            ["Verification", <Badge key="v" tone={d.verificationStatus === "APPROVED" ? "ok" : d.verificationStatus === "SUSPENDED" || d.verificationStatus === "REJECTED" ? "bad" : "warn"}>{d.verificationStatus.toLowerCase().replace("_", " ")}</Badge>],
            ["Availability", d.availability.toLowerCase()],
            ["Can work right now", eligibility.eligible ? "yes" : `no — ${eligibility.reasons.join("; ")}`],
            ["Email", `${d.user.email} ${d.user.emailVerifiedAt ? "(confirmed)" : "(not confirmed)"}`],
            ["Cellphone", phone],
            ["Vehicle", vehicle ? `${vehicle.type.toLowerCase()}${vehicle.registration ? ` · ${vehicle.registration}` : ""}${vehicle.makeModel ? ` · ${vehicle.makeModel}` : ""}` : "—"],
            ["Bank", d.payoutBankName ? `${d.payoutBankName} · account ending ${d.payoutAccountLast4}` : "—"],
            ["Submitted / reviewed", `${when(d.submittedAt)} / ${when(d.reviewedAt)}`],
            ["Review note", d.reviewNote ?? "—"],
            ["Suspension", d.suspensionReason ? `${d.suspensionReason} (${when(d.suspendedAt)})` : "—"],
          ]}
        />
      </Section>

      <Section title="Legal acceptance">
        <p style={{ opacity: 0.8 }}>
          Current: {legal.ok ? `terms ${legal.terms.version}, privacy ${legal.privacy.version}` : "driver terms and privacy notice are NOT configured — approvals are blocked"}
        </p>
        <Table head={["Document", "Version", "Accepted"]} rows={legalRows.map((r) => [r.kind.toLowerCase(), r.version, when(r.acceptedAt)])} empty="Nothing accepted yet." />
      </Section>

      <Section title="Documents">
        <p style={{ opacity: 0.8 }}>Needed for this vehicle: {required.map((k) => DOCUMENT_LABELS[k]).join(", ")}.</p>
        {!canDocs ? (
          <p>Your role can see that documents exist, not open them.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
            {d.documents.length === 0 && <li>No documents uploaded.</li>}
            {d.documents.map((doc) => (
              <li key={doc.id} style={{ borderTop: "1px solid var(--edge)", paddingTop: 8 }}>
                <strong>{DOCUMENT_LABELS[doc.kind]}</strong> · {doc.status.toLowerCase()} · {(doc.sizeBytes / 1024).toFixed(0)} KB · {when(doc.uploadedAt)}
                {doc.expiresOn && <> · expires {doc.expiresOn.toISOString().slice(0, 10)}</>}
                {doc.reviewNote && <> · note: {doc.reviewNote}</>}
                <div>
                  <a href={`/api/admin/driver-documents/${doc.id}`}>Download to check</a> <span style={{ opacity: 0.7 }}>(each download is recorded in the audit log)</span>
                </div>
                {doc.status === "PENDING" && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                    <form action={reviewDocumentAction.bind(null, d.id, doc.id, "ACCEPTED")}>
                      <button type="submit" className="btn btnPrimary">Accept</button>
                    </form>
                    <form action={reviewDocumentAction.bind(null, d.id, doc.id, "REJECTED")} style={{ display: "flex", gap: 8 }}>
                      <ReasonField placeholder="Why? (the driver sees this)" />
                      <button type="submit" className="btn">Reject</button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {canManage && (
        <Section title="Decision">
          <div style={{ display: "grid", gap: 10 }}>
            {d.verificationStatus === "PENDING_REVIEW" && (
              <>
                <form action={decideDriverAction.bind(null, d.id, "APPROVE")} style={{ display: "flex", gap: 8 }}>
                  <ReasonField placeholder="Approval note (what you checked)" />
                  <button type="submit" className="btn btnPrimary">Approve driver</button>
                </form>
                <form action={decideDriverAction.bind(null, d.id, "REJECT")} style={{ display: "flex", gap: 8 }}>
                  <ReasonField placeholder="What must the driver fix? (they see this)" />
                  <button type="submit" className="btn">Send back</button>
                </form>
              </>
            )}
            {(d.verificationStatus === "APPROVED" || d.verificationStatus === "PENDING_REVIEW") && (
              <form action={decideDriverAction.bind(null, d.id, "SUSPEND")} style={{ display: "flex", gap: 8 }}>
                <ReasonField placeholder="Reason for suspension" />
                <button type="submit" className="btn">Suspend now</button>
              </form>
            )}
            {d.verificationStatus === "SUSPENDED" && (
              <form action={decideDriverAction.bind(null, d.id, "REINSTATE")} style={{ display: "flex", gap: 8 }}>
                <ReasonField placeholder="Why reinstate?" />
                <button type="submit" className="btn btnPrimary">Reinstate</button>
              </form>
            )}
          </div>
        </Section>
      )}

      <Section title="Deliveries (latest 20)">
        <Table
          head={["Delivery", "Shop", "Status", "Earning", "Created", "Note"]}
          rows={deliveries.map((x) => [<Link key="d" href={`/platform-admin/deliveries/${x.id}`}>{x.id.slice(0, 10)}…</Link>, x.business.name, x.status.toLowerCase(), formatCents(x.driverEarningCents), when(x.createdAt), x.endReason ?? ""])}
          empty="No deliveries yet."
        />
        {incidents.length > 0 && <p><Badge tone="warn">{incidents.length} incident(s)</Badge> among these (failed, returned or disputed).</p>}
      </Section>

      <Section title="Earnings & payouts">
        <Stats
          items={[
            { label: "Pending (held 24h)", value: formatCents(balance.pendingCents) },
            { label: "Available", value: formatCents(balance.availableCents) },
            { label: "In a payout", value: formatCents(balance.inPayoutCents) },
            { label: "Paid", value: formatCents(balance.paidCents) },
          ]}
        />
        <Table
          head={["When", "Type", "Status", "Amount", "Reason", "Reference", "In payout"]}
          rows={ledger.map((e) => [when(e.createdAt), e.type.toLowerCase(), e.status.toLowerCase(), formatCents(e.amountCents), e.reason ?? "", e.reference ?? "", e.payoutId ? "yes" : ""])}
          empty="No ledger entries."
        />
        <Table head={["Payout", "Amount", "Status", "Reference", "Created", "Paid"]} rows={payouts.map((p) => [p.id.slice(0, 10), formatCents(p.amountCents), p.status.toLowerCase(), p.reference ?? "", when(p.createdAt), when(p.paidAt)])} empty="No payouts." />
        {canPay && (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {balance.availableCents > 0 && (
              <form action={createPayoutAction.bind(null, d.id)}>
                <button type="submit" className="btn">Create payout of {formatCents(balance.availableCents)}</button>
              </form>
            )}
            <form action={adjustLedgerAction.bind(null, d.id)} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <input className="input" name="amountRands" placeholder="Amount in rand (−10.50 to deduct)" required inputMode="decimal" style={{ maxWidth: 220 }} />
              <input className="input" name="reference" placeholder="Reference (ticket / EFT)" required maxLength={100} style={{ maxWidth: 200 }} />
              <ReasonField placeholder="Reason for the adjustment" />
              <button type="submit" className="btn">Add ledger adjustment</button>
            </form>
            <p style={{ opacity: 0.75, margin: 0 }}>Balances are never edited — an adjustment is a new ledger entry with your name, reason and reference.</p>
          </div>
        )}
      </Section>
    </>
  );
}
