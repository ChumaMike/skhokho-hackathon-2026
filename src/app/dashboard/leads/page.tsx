import Link from "next/link";
import type { StorefrontLeadStatus } from "@prisma/client";
import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireAnyStaffPermission } from "@/lib/auth/guards";
import { LEAD_STATUS_LABELS, LEAD_STATUSES, listLeads } from "@/modules/storefront-workflows/leads.service";
import { WORKFLOWS, describeLeadDetails } from "@/modules/storefront-workflows/workflows";
import DashboardNav from "@/components/DashboardNav";
import styles from "./leads.module.css";

export const dynamic = "force-dynamic";

type Filter = "OPEN" | StorefrontLeadStatus | "ALL";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "OPEN", label: "Open" },
  ...LEAD_STATUSES.map((s) => ({ id: s as Filter, label: LEAD_STATUS_LABELS[s] })),
  { id: "ALL", label: "All" },
];

function chipClass(status: StorefrontLeadStatus): string {
  if (status === "NEW") return `${styles.chip} ${styles.chipNew}`;
  if (status === "WON") return `${styles.chip} ${styles.chipWon}`;
  if (status === "CLOSED") return `${styles.chip} ${styles.chipClosed}`;
  return styles.chip;
}

function when(date: Date): string {
  return date.toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Dashboard › Enquiries: every quote, enquiry, pickup and callback request
 * from the storefront, newest first, with its status. One tap opens the
 * request with WhatsApp and call links.
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; err?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireAnyStaffPermission(["canManageCustomers", "canManageBookings"]);
  } catch {
    permitted = false;
  }

  const filter: Filter = FILTERS.some((f) => f.id === sp.status) ? (sp.status as Filter) : "OPEN";
  const leads = permitted ? await listLeads(session.tenantId, filter === "ALL" ? {} : { status: filter }) : [];

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Enquiries</h1>
        <p className={styles.sub}>Quote, enquiry, pickup and callback requests from your website. Reply on WhatsApp or call, then mark where each one stands.</p>
        <DashboardNav current="leads" {...workspaceContext} />

        {!permitted ? (
          <div className="errorBanner">Your role doesn&apos;t have permission to see enquiries — ask the business owner.</div>
        ) : (
          <>
            {sp.err && <div className="errorBanner">{sp.err}</div>}
            <nav className={styles.filters} aria-label="Filter by status">
              {FILTERS.map((f) => (
                <Link key={f.id} href={f.id === "OPEN" ? "/dashboard/leads" : `/dashboard/leads?status=${f.id}`} className={`${styles.filter} ${f.id === filter ? styles.filterActive : ""}`}>
                  {f.label}
                </Link>
              ))}
            </nav>

            {leads.length === 0 ? (
              <div className={`card ${styles.empty}`}>
                {filter === "OPEN" ? (
                  <>
                    No open enquiries. When a customer sends a request from your website it shows up here.{" "}
                    <Link href="/dashboard/storefront/actions">Choose which requests customers can send →</Link>
                  </>
                ) : (
                  "Nothing here yet."
                )}
              </div>
            ) : (
              <ul className={styles.list}>
                {leads.map((lead) => {
                  const facts = describeLeadDetails(lead.kind, workspaceContext.businessCategory, lead.details).slice(0, 2);
                  return (
                    <li key={lead.id}>
                      <Link href={`/dashboard/leads/${lead.id}`} className={`card ${styles.row}`}>
                        <div>
                          <p className={styles.rowTitle}>
                            {lead.customerName} <span className={styles.chip}>{WORKFLOWS[lead.kind].inboxLabel}</span>
                          </p>
                          <p className={styles.rowMeta}>
                            <span className={styles.phone}>{lead.phone}</span>
                            {lead.serviceName ? ` · ${lead.serviceName}` : ""}
                            {facts.map((f) => ` · ${f.label}: ${f.value}`).join("")}
                            {lead.photos.length > 0 ? ` · ${lead.photos.length} photo${lead.photos.length === 1 ? "" : "s"}` : ""}
                          </p>
                        </div>
                        <p className={styles.rowMeta}>{when(lead.createdAt)}</p>
                        <span className={chipClass(lead.status)}>{LEAD_STATUS_LABELS[lead.status]}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}
