import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireAnyStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { LEAD_STATUS_LABELS, LEAD_STATUSES, MAX_OWNER_NOTES, getLead, leadWhatsappHref } from "@/modules/storefront-workflows/leads.service";
import { WORKFLOWS, describeLeadDetails } from "@/modules/storefront-workflows/workflows";
import DashboardNav from "@/components/DashboardNav";
import { saveLeadNotesAction, setLeadStatusAction } from "../actions";
import styles from "../leads.module.css";

export const dynamic = "force-dynamic";

function when(date: Date): string {
  return date.toLocaleString("en-ZA", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** One request: what the customer asked, their photos, a WhatsApp reply with a sensible opener, a call link, status and the owner's own notes. */
export default async function LeadPage({ params, searchParams }: { params: Promise<{ leadId: string }>; searchParams: Promise<{ err?: string; saved?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const { leadId } = await params;
  const sp = await searchParams;

  try {
    await requireAnyStaffPermission(["canManageCustomers", "canManageBookings"]);
  } catch {
    notFound();
  }

  const [lead, business] = await Promise.all([getLead(session.tenantId, leadId), prisma.business.findUniqueOrThrow({ where: { id: session.tenantId }, select: { name: true } })]);
  if (!lead) notFound();

  const workflow = WORKFLOWS[lead.kind];
  const facts = describeLeadDetails(lead.kind, workspaceContext.businessCategory, lead.details);
  const wa = leadWhatsappHref(lead, business.name);
  const membership = lead.membershipId
    ? await prisma.membership.findUnique({ where: { id: lead.membershipId }, select: { shortCode: true, publicId: true } })
    : null;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Enquiries · {workflow.inboxLabel}</span>
        <h1 className={styles.title}>{lead.customerName}</h1>
        <p className={styles.sub}>
          <Link href="/dashboard/leads">← All enquiries</Link> · {when(lead.createdAt)}
        </p>
        <DashboardNav current="leads" {...workspaceContext} />

        {sp.err && <div className="errorBanner">{sp.err}</div>}
        {sp.saved && <div className="successBanner">Saved.</div>}

        <div className={styles.detailGrid}>
          <section className={`card ${styles.card}`}>
            <dl className={styles.facts}>
              <dt>Phone</dt>
              <dd>
                <a className={styles.phone} href={`tel:${lead.phone}`}>
                  {lead.phone}
                </a>
              </dd>
              {lead.email && (
                <>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${lead.email}`}>{lead.email}</a>
                  </dd>
                </>
              )}
              {lead.serviceName && (
                <>
                  <dt>Service</dt>
                  <dd>{lead.serviceName}</dd>
                </>
              )}
              {facts.map((f) => (
                <div key={f.label} style={{ display: "contents" }}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
              {membership && (
                <>
                  <dt>Customer card</dt>
                  <dd>
                    <Link href={`/dashboard/customers/${membership.publicId}`} className={styles.phone}>
                      {membership.shortCode}
                    </Link>
                  </dd>
                </>
              )}
            </dl>
            {lead.message && <p className={styles.message}>{lead.message}</p>}
            {lead.photos.length > 0 && (
              <div className={styles.photos}>
                {lead.photos.map((src, i) => (
                  <a key={src} href={src} target="_blank" rel="noopener noreferrer">
                    {/* Customer-supplied photo stored in the business's own image store. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Photo ${i + 1} from ${lead.customerName}`} loading="lazy" />
                  </a>
                ))}
              </div>
            )}
            <div className={styles.actions}>
              {wa && (
                <a className="btn btnPrimary" href={wa} target="_blank" rel="noopener noreferrer">
                  Reply on WhatsApp
                </a>
              )}
              <a className="btn" href={`tel:${lead.phone}`}>
                Call
              </a>
            </div>
          </section>

          <aside className={`card ${styles.card}`}>
            <strong>Where it stands</strong>
            <div className={styles.statusRow}>
              {LEAD_STATUSES.map((status) => (
                <form key={status} action={setLeadStatusAction.bind(null, lead.id, status)}>
                  <button type="submit" className={`btn ${styles.statusBtn} ${status === lead.status ? "btnPrimary" : ""}`} disabled={status === lead.status}>
                    {LEAD_STATUS_LABELS[status]}
                  </button>
                </form>
              ))}
            </div>
            <form action={saveLeadNotesAction.bind(null, lead.id)} className={styles.card} style={{ padding: 0 }}>
              <label className="label" htmlFor="notes">
                Your notes
              </label>
              <textarea className="input" id="notes" name="notes" rows={5} defaultValue={lead.ownerNotes ?? ""} maxLength={MAX_OWNER_NOTES} placeholder="e.g. Quoted R850, waiting for a yes." />
              <div>
                <button type="submit" className="btn">
                  Save note
                </button>
              </div>
            </form>
            <p className={styles.hint}>Only your team sees these notes.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
