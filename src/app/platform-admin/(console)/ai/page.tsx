import Link from "next/link";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { aiPlatformMetrics, configStatus } from "@/modules/platform-admin/metrics";
import { formatUsdMicros } from "@/lib/ai/pricing";
import { PageHeader, Section, Stats, Table } from "../ui";

export const dynamic = "force-dynamic";

/** AI usage — counts only; no conversation content is shown here. */
export default async function AiAdminPage() {
  await adminPage("ai.view");
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [conversations30, actions30, actionsByStatus, revisions30, patternCandidates] = await Promise.all([
    prisma.assistantConversation.count({ where: { updatedAt: { gte: since } } }),
    prisma.buddyAction.count({ where: { createdAt: { gte: since } } }),
    prisma.buddyAction.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.storefrontRevision.count({ where: { createdAt: { gte: since } } }),
    prisma.storefrontPatternCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const config = configStatus();
  const ai = await aiPlatformMetrics();
  return (
    <>
      <PageHeader title="AI" sub="Last 30 days. Counts only — conversation content is never shown in the admin." />
      <Stats
        items={[
          { label: "External AI provider", value: config.externalAi ? "enabled" : "off (rules only)" },
          { label: "Buddy conversations active", value: conversations30 },
          { label: "Buddy actions", value: actions30 },
          { label: "Storefront revisions", value: revisions30 },
        ]}
      />
      <Section title="External AI calls (this month)">
        <Stats
          items={[
            { label: "Calls OK", value: ai.month.ok },
            { label: "Failed / timed out / rejected", value: ai.month.failed, tone: ai.month.failed ? "warn" : undefined },
            { label: "Refused before the provider", value: ai.month.blocked },
            { label: "Tokens", value: ai.month.tokens },
            { label: "Est. provider spend", value: formatUsdMicros(ai.month.estimatedCostUsdMicros) },
            { label: "Calls OK / failed (24h)", value: `${ai.last24h.ok} / ${ai.last24h.failed}` },
          ]}
        />
        <Table
          head={["Business approaching allowance", "Used", "Limit"]}
          rows={ai.approaching.map((a) => [<Link key="b" href={`/platform-admin/businesses/${a.businessId}`}>{a.name}</Link>, a.used, a.limit])}
          empty="No business is at 80% of its monthly AI allowance."
        />
        <p style={{ opacity: 0.75 }}>Every external model call is one row in ai_usage_events — who, which capability, tokens, outcome. Prompts and answers are never stored.</p>
      </Section>
      <Section title="Assistant actions by status">
        <Table head={["Status", "Count"]} rows={actionsByStatus.map((r) => [r.status.toLowerCase(), r._count._all])} empty="None." />
      </Section>
      <Section title="Storefront learning">
        <Table head={["Pattern status", "Count"]} rows={patternCandidates.map((r) => [r.status.toLowerCase(), r._count._all])} empty="No candidates." />
        <Link href="/platform-admin/storefront-patterns">Review patterns →</Link>
      </Section>
    </>
  );
}
