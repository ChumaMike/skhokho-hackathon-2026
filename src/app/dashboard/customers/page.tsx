import Link from "next/link";
import { prisma } from "@/lib/prisma/client";
import {
  listMembers,
  getRegulars,
  getLapsed,
  type MemberRow,
} from "@/modules/customers/customer.service";
import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireAnyStaffPermission } from "@/lib/auth/guards";
import DashboardNav from "@/components/DashboardNav";
import StampCard from "./StampCard";
import styles from "./customers.module.css";

export const dynamic = "force-dynamic";

type View = "all" | "regulars" | "lapsed";

const TABS: { key: View; label: string }[] = [
  { key: "all", label: "All" },
  { key: "regulars", label: "Regulars" },
  { key: "lapsed", label: "Lapsed" },
];

function daysAgoLabel(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 31) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  }
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? "s" : ""} ago`;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; added?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;
  const view: View =
    sp.view === "regulars" || sp.view === "lapsed" ? sp.view : "all";

  // Checked before any customer data is fetched. Kitchen/Driver/Service
  // Provider/Stock have neither flag and must not be able to read the
  // customer database merely by navigating here directly.
  let permitted = true;
  try {
    await requireAnyStaffPermission(["canManageCustomers", "canIssueLoyalty"]);
  } catch {
    permitted = false;
  }

  if (!permitted) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.title}>Your customers</h1>
          <DashboardNav current="customers" {...workspaceContext} />
          <div className={`card ${styles.empty}`}>
            <p>Your role doesn&apos;t have permission to view customers — ask the business owner.</p>
          </div>
        </div>
      </main>
    );
  }

  const business = await prisma.business.findUnique({
    where: { id: session.tenantId },
    select: { config: true },
  });
  // listMembers/getRegulars/getLapsed report stamps/redeems but not the
  // per-business stamp threshold — that lives on Business.config, read
  // directly here (same default the redeem_reward RPC itself falls back to).
  const config = business?.config as
    | { loyalty_stamps_required?: number }
    | null
    | undefined;
  const required =
    typeof config?.loyalty_stamps_required === "number" &&
    config.loyalty_stamps_required > 0
      ? config.loyalty_stamps_required
      : 10;

  const members: MemberRow[] =
    view === "regulars"
      ? await getRegulars(session.tenantId)
      : view === "lapsed"
        ? await getLapsed(session.tenantId)
        : await listMembers(session.tenantId);

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Your customers</h1>

        <DashboardNav current="customers" {...workspaceContext} />

        {sp.added && (
          <div className="successBanner">
            Added — their code is{" "}
            <span className="mono">{sp.added}</span>
          </div>
        )}

        <nav className={styles.tabs}>
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={
                tab.key === "all"
                  ? "/dashboard/customers"
                  : `/dashboard/customers?view=${tab.key}`
              }
              className={`${styles.tab} ${view === tab.key ? styles.tabActive : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {members.length === 0 ? (
          <div className={`card ${styles.empty}`}>
            <p>
              {view === "lapsed"
                ? "No lapsed customers — everyone's been in recently."
                : view === "regulars"
                  ? "No regulars yet — keep stamping and they'll show up here."
                  : "No customers yet. Add your first one and start their card."}
            </p>
          </div>
        ) : (
          <div>
            {members.map((m) => (
              <StampCard
                key={m.public_id}
                publicId={m.public_id}
                shortCode={m.short_code}
                displayName={m.display_name}
                stamps={m.stamps}
                redeems={m.redeems}
                required={required}
                lastSeenLabel={daysAgoLabel(m.last_seen)}
                lapsed={view === "lapsed"}
              />
            ))}
          </div>
        )}
      </div>

      <div className="bottomBar">
        <div className="bottomBarInner">
          <Link
            href="/dashboard/customers/add"
            className="btn btnPrimary btnBlock"
          >
            Add a customer
          </Link>
        </div>
      </div>
    </main>
  );
}
