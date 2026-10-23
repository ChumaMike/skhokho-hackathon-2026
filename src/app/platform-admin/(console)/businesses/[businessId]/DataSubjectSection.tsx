import { adminPage } from "@/modules/platform-admin/page-guard";
import { can } from "@/modules/platform-admin/permissions";
import { listDataSubjectRequests, ERASABLE_BUSINESS_STATUSES } from "@/modules/privacy/data-subject.service";
import { ReasonField, Section, Table, when } from "../../ui";
import { eraseBusinessAction } from "../actions";

/**
 * Tab 5 — the business's own data-subject requests: export as JSON, and
 * erasure once the business is suspended or deactivated (SUPER_ADMIN only,
 * reason required). Lists what has been done so far.
 */
export default async function DataSubjectSection({ businessId, status }: { businessId: string; status: string }) {
  const admin = await adminPage("businesses.view");
  if (!can(admin.role, "privacy.manage")) return null;
  const requests = await listDataSubjectRequests(businessId, 20);
  const erasable = (ERASABLE_BUSINESS_STATUSES as readonly string[]).includes(status);
  const alreadyErased = requests.some((r) => r.kind === "ERASE" && r.subject === "BUSINESS");

  return (
    <Section title="Data-subject requests">
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <a className="btn" href={`/platform-admin/businesses/${businessId}/export`}>Export business data (JSON)</a>
        <span style={{ opacity: 0.75 }}>Customers are handled by phone under Data-subject requests.</span>
      </p>
      {can(admin.role, "businesses.erase") && (
        <form action={eraseBusinessAction.bind(null, businessId)} style={{ display: "grid", gap: 8, maxWidth: 520, marginTop: 12 }}>
          <strong>{alreadyErased ? "Erased — re-running is safe and only scrubs what is new." : "Erase this business's personal data"}</strong>
          <span style={{ opacity: 0.8 }}>
            {erasable
              ? "De-identifies the business, its staff, its customers' records here and the owner's sign-in (if this was their only business). Payment and domain history stays with personal fields scrubbed. Cannot be undone."
              : "Suspend or deactivate the business first — erasure is the last step of closing it."}
          </span>
          <ReasonField placeholder="Reason (who asked, when, reference)" />
          <button type="submit" className="btn" disabled={!erasable}>Erase business data</button>
        </form>
      )}
      <Table
        head={["When", "Kind", "Subject", "Customer", "By", "Reason"]}
        rows={requests.map((r) => [when(r.createdAt), r.kind.toLowerCase(), r.subject.toLowerCase(), r.membershipPublicId ? r.membershipPublicId.slice(0, 8) : "—", `${r.actorType} ${r.actorId.slice(0, 8)}`, r.reason ?? "—"])}
        empty="No export or erasure recorded for this business."
      />
    </Section>
  );
}
