import Link from "next/link";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { can } from "@/modules/platform-admin/permissions";
import { findMembershipsByPhone, DataSubjectError, type MembershipByPhone } from "@/modules/privacy/data-subject.service";
import { formatSAPhone } from "@/lib/utils";
import { Badge, Banner, PageHeader, ReasonField, Section, Table, when } from "../ui";
import { eraseCustomerAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Data-subject requests, keyed by the phone a customer gives us (Tab 5).
 * A person's relationships with businesses are listed by pairwise ids only
 * — the global customer id never reaches this page. Export produces a JSON
 * file; erasure needs a reason and is recorded. The customer-facing
 * self-service button waits for Customer accounts.
 */
export default async function DataSubjectsPage({ searchParams }: { searchParams: Promise<{ phone?: string; ok?: string; err?: string }> }) {
  const admin = await adminPage("privacy.manage");
  const sp = await searchParams;
  const phone = (sp.phone ?? "").trim();

  let lookup: { phone: string; memberships: MembershipByPhone[] } | null = null;
  let lookupError: string | null = null;
  if (phone) {
    try {
      lookup = await findMembershipsByPhone(phone);
    } catch (e) {
      lookupError = e instanceof DataSubjectError ? e.message : "Could not look that number up.";
    }
  }

  return (
    <>
      <PageHeader title="Data-subject requests" sub="Access, correction and erasure requests from customers, keyed by their phone number. Businesses are handled from their own page." />
      <Banner ok={sp.ok === "erased" ? "Customer erased at that business and the request recorded." : undefined} err={sp.err ?? lookupError ?? undefined} />

      <Section title="Find a customer">
        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" name="phone" inputMode="tel" placeholder="082 123 4567" defaultValue={phone} required aria-label="Customer phone number" style={{ maxWidth: 240 }} />
          <button type="submit" className="btn btnPrimary">Look up</button>
        </form>
        <p style={{ opacity: 0.75, marginTop: 8 }}>
          Each row is one relationship with one business. Export gives that business&apos;s record of the person as JSON; erase de-identifies it there (and the person entirely once no business still has a live relationship). Visits stay as counts — they hold nothing personal.
        </p>
      </Section>

      {lookup && (
        <Section title={`${lookup.memberships.length} relationship${lookup.memberships.length === 1 ? "" : "s"} for ${formatSAPhone(lookup.phone)}`}>
          <Table
            head={["Business", "Customer code", "Name", "Status", "First seen", "Last seen", "Export", "Erase"]}
            rows={lookup.memberships.map((m) => [
              <Link key="b" href={`/platform-admin/businesses/${m.businessId}`}>{m.businessName}</Link>,
              m.shortCode,
              m.displayName ?? "—",
              <Badge key="s" tone={m.status === "active" ? "ok" : undefined}>{m.status}</Badge>,
              when(m.firstSeen),
              when(m.lastSeen),
              <a key="x" className="btn" href={`/platform-admin/data-subjects/export?business=${m.businessId}&publicId=${m.publicId}&phone=${encodeURIComponent(lookup!.phone)}`}>
                JSON
              </a>,
              m.status === "active" && can(admin.role, "privacy.manage") ? (
                <form key="e" action={eraseCustomerAction.bind(null, m.businessId, m.publicId, lookup!.phone)} style={{ display: "grid", gap: 6, minWidth: 220 }}>
                  <ReasonField placeholder="Reason (e.g. request received on …)" />
                  <button type="submit" className="btn">Erase here</button>
                </form>
              ) : (
                "—"
              ),
            ])}
            empty="No business has a customer with that number."
          />
        </Section>
      )}
    </>
  );
}
