import Link from "next/link";
import { contentGate } from "../gate";
import ContentShell from "../ContentShell";
import { listPlanned } from "@/modules/content/drafts";
import { TYPE_LABELS, CHANNEL_LABELS } from "@/modules/content/generation";
import styles from "../content.module.css";

export const dynamic = "force-dynamic";

/** A planning list, not a scheduler: what the merchant intends to post over the next 30 days. Nothing is posted by the platform. */
export default async function CalendarPage() {
  const gate = await contentGate();
  const ready = gate.permitted && gate.entitled;
  const planned = ready && gate.canCalendar ? await listPlanned(gate.actor, { days: 30 }) : null;
  const dayKey = (d: Date) => d.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short" });
  const byDay = new Map<string, typeof planned extends null ? never : NonNullable<typeof planned>["drafts"]>();
  for (const d of planned?.drafts ?? []) {
    const k = dayKey(d.plannedFor!);
    byDay.set(k, [...(byDay.get(k) ?? []), d]);
  }

  return (
    <ContentShell gate={gate} current="calendar" title="Content calendar" lede="The next 30 days. Set a planned date on any draft; mark it posted once you've put it up yourself.">
      {ready && !gate.canCalendar ? (
        <div className={`card ${styles.panel}`}>
          <p>The calendar isn&apos;t included in your plan. You can still set planned dates on drafts and see them in the Drafts list.</p>
        </div>
      ) : planned ? (
        <>
          {planned.campaigns.length > 0 && (
            <div className={`card ${styles.panel}`}>
              <h2 className={styles.h2}>Campaigns running</h2>
              {planned.campaigns.map((c) => (
                <p key={c.id}>
                  <Link href={`/dashboard/content/campaigns/${c.id}`}>{c.name}</Link> · {c.startsAt ? dayKey(c.startsAt) : "no start"} – {c.endsAt ? dayKey(c.endsAt) : "no end"} · {c.status.toLowerCase()}
                </p>
              ))}
            </div>
          )}
          {byDay.size === 0 ? (
            <div className={`card ${styles.panel}`}>
              <p>Nothing planned yet. Open a draft and set &ldquo;Planned for&rdquo;.</p>
            </div>
          ) : (
            <div className={styles.list}>
              {[...byDay.entries()].map(([day, drafts]) => (
                <div key={day} className={`card ${styles.calendarDay}`}>
                  <p className={styles.calendarDate}>{day}</p>
                  {drafts.map((d) => (
                    <p key={d.id}>
                      <Link href={`/dashboard/content/drafts/${d.id}`}>{d.title}</Link> · {TYPE_LABELS[d.type]} · {CHANNEL_LABELS[d.channel]} · {d.status.toLowerCase().replace("_", " ")}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </ContentShell>
  );
}
