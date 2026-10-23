import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { prisma } from "@/lib/prisma/client";
import { getStorefrontConfig, getAvailablePrimaryActions, type PrimaryCustomerAction } from "@/modules/tenant/storefront-theme";
import { activeWorkflowsFor, workflowsInPlan } from "@/modules/storefront-workflows/access";
import { WORKFLOWS, WORKFLOW_IDS, primaryWorkflow } from "@/modules/storefront-workflows/workflows";
import DashboardNav from "@/components/DashboardNav";
import { setPrimaryActionAction, setWorkflowCapabilityAction } from "./actions";
import styles from "../storefront.module.css";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<PrimaryCustomerAction, string> = {
  ORDER: "Order",
  BOOK: "Book",
  ENQUIRE: "Send a request",
  WHATSAPP: "Message on WhatsApp",
  CALL: "Call",
  VISIT: "Visit us",
  BROWSE: "Just browse",
  LOYALTY: "Join for rewards",
};

const ALL_ACTIONS: PrimaryCustomerAction[] = ["ORDER", "BOOK", "ENQUIRE", "WHATSAPP", "CALL", "VISIT", "LOYALTY", "BROWSE"];

export default async function StorefrontActionsPage({ searchParams }: { searchParams: Promise<{ err?: string; saved?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: session.tenantId } });

  const storefront = getStorefrontConfig(business);
  const [workflows, planAllows] = await Promise.all([activeWorkflowsFor(session.tenantId, workspaceContext.capabilities), workflowsInPlan(session.tenantId)]);
  const available = new Set(getAvailablePrimaryActions(workspaceContext.capabilities, business, workflows));
  const current = storefront.theme.primaryAction;
  const primary = primaryWorkflow(workflows);

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Customer actions</h1>
        <p className={styles.sub}>
          What should customers do first when they land on your storefront? This never changes what staff can do —
          only what&apos;s emphasised for customers.
        </p>

        <DashboardNav current="storefront" {...workspaceContext} />

        {sp.err && <div className="errorBanner">{sp.err}</div>}
        {sp.saved && <div className="successBanner">Saved.</div>}

        <div className={styles.recList}>
          {ALL_ACTIONS.map((action) => (
            <form key={action} action={setPrimaryActionAction.bind(null, action)}>
              <button
                type="submit"
                disabled={!available.has(action)}
                className="card"
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 16px",
                  opacity: available.has(action) ? 1 : 0.4,
                  borderColor: current === action ? "var(--amber)" : undefined,
                  borderWidth: current === action ? 2 : undefined,
                }}
              >
                {action === "ENQUIRE" && primary ? `${ACTION_LABELS.ENQUIRE} — ${WORKFLOWS[primary].ctaLabel}` : ACTION_LABELS[action]}
                {!available.has(action) && " (not available for your business yet)"}
              </button>
            </form>
          ))}
        </div>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Requests customers can send you</h2>
          <p className={styles.sub}>
            Each one is a page on your website with a short form. Requests land in <Link href="/dashboard/leads">Enquiries</Link>, where you
            reply on WhatsApp or by phone.
            {!planAllows && " Request forms are part of the Grow and Pro plans — switch them on here and they appear as soon as your plan includes them."}
          </p>
          <div className={styles.recList}>
            {WORKFLOW_IDS.map((id) => {
              const w = WORKFLOWS[id];
              const on = workspaceContext.capabilities.has(w.capability);
              return (
                <form key={id} action={setWorkflowCapabilityAction.bind(null, w.capability, !on)} className="card" style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <strong>{w.title}</strong>
                      <p className={styles.sub} style={{ margin: "4px 0 0" }}>
                        {w.intro} {w.photos ? "Customers can attach photos." : ""}
                        {on && !planAllows && " Not showing yet — not in your plan."}
                      </p>
                    </div>
                    <button type="submit" className={on ? "btn" : "btn btnPrimary"}>
                      {on ? "Switch off" : "Switch on"}
                    </button>
                  </div>
                </form>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
