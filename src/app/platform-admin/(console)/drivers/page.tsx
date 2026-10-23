import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { Badge, Filters, PageHeader, Section, Table, when } from "../ui";

export const dynamic = "force-dynamic";

/** Verification tabs and live-availability tabs (approved drivers only). */
const VIEWS: Record<string, { label: string; where: Prisma.DriverProfileWhereInput }> = {
  pending: { label: "Pending review", where: { verificationStatus: "PENDING_REVIEW" } },
  approved: { label: "Approved", where: { verificationStatus: "APPROVED" } },
  online: { label: "Online", where: { verificationStatus: "APPROVED", availability: "ONLINE" } },
  busy: { label: "Busy", where: { verificationStatus: "APPROVED", availability: "BUSY" } },
  offline: { label: "Offline", where: { verificationStatus: "APPROVED", availability: { in: ["OFFLINE", "PAUSED"] } } },
  rejected: { label: "Rejected", where: { verificationStatus: "REJECTED" } },
  suspended: { label: "Suspended", where: { verificationStatus: "SUSPENDED" } },
  draft: { label: "Still applying", where: { verificationStatus: "DRAFT" } },
};

/** Skhokholetha drivers. No documents, bank details or locations in the list. */
export default async function DriversAdminPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await adminPage("drivers.view");
  const sp = await searchParams;
  const view = sp.view && VIEWS[sp.view] ? sp.view : "pending";
  const [drivers, counts] = await Promise.all([
    prisma.driverProfile.findMany({
      where: VIEWS[view].where,
      orderBy: view === "pending" ? { submittedAt: "asc" } : { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        displayName: true,
        verificationStatus: true,
        availability: true,
        submittedAt: true,
        reviewedAt: true,
        agreementVersion: true,
        vehicles: { where: { isActive: true }, select: { type: true } },
        _count: { select: { deliveries: true } },
      },
    }),
    Promise.all(Object.entries(VIEWS).map(async ([k, v]) => [k, await prisma.driverProfile.count({ where: v.where })] as const)),
  ]);
  const n = Object.fromEntries(counts);

  return (
    <>
      <PageHeader title="Drivers" sub="Skhokholetha. Pending applications oldest first." />
      <Filters base="/platform-admin/drivers" param="view" current={view} options={Object.entries(VIEWS).map(([k, v]) => ({ value: k, label: `${v.label} (${n[k]})` }))} />
      <Section title={VIEWS[view].label}>
        <Table
          head={["Driver", "Verification", "Availability", "Vehicle", "Deliveries", "Terms version", "Submitted", "Reviewed"]}
          rows={drivers.map((d) => [
            <Link key="n" href={`/platform-admin/drivers/${d.id}`}>{d.displayName || "(no name yet)"}</Link>,
            <Badge key="v" tone={d.verificationStatus === "APPROVED" ? "ok" : d.verificationStatus === "SUSPENDED" || d.verificationStatus === "REJECTED" ? "bad" : "warn"}>{d.verificationStatus.toLowerCase().replace("_", " ")}</Badge>,
            d.availability.toLowerCase(),
            d.vehicles[0]?.type.toLowerCase() ?? "—",
            d._count.deliveries,
            d.agreementVersion ?? "—",
            when(d.submittedAt),
            when(d.reviewedAt),
          ])}
        />
      </Section>
      <p style={{ opacity: 0.75 }}>
        <Link href="/platform-admin/payouts">Payouts →</Link> · <Link href="/platform-admin/deliveries">Deliveries →</Link>
      </p>
    </>
  );
}
