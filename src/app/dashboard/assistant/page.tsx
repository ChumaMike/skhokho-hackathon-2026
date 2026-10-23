import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import DashboardNav from "@/components/DashboardNav";
import AssistantChat from "./AssistantChat";
import styles from "./assistant.module.css";

export const dynamic = "force-dynamic";

/**
 * v1 is read-only Q&A over the business's own data (regulars, lapsed,
 * orders, bookings) — no side effects, nothing it can send or change.
 * Answers come from a rules-based provider until ANTHROPIC_API_KEY is set,
 * see src/modules/assistant/llm-provider.ts; the UI says so plainly rather
 * than pretending to be a live model it isn't yet.
 */
export default async function AssistantPage() {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Ask Skhokho</h1>
        <p className={styles.lede}>
          Ask about your regulars, who&apos;s lapsed, this week&apos;s orders, upcoming
          bookings — or ask for a post, a WhatsApp status or a campaign.
        </p>

        <DashboardNav current="assistant" {...workspaceContext} />

        <AssistantChat />
      </div>
    </main>
  );
}
