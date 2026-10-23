"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AssistantDock.module.css";

interface Line {
  key: string;
  text: string;
  href?: string;
}

interface Recommendation {
  key: string;
  text: string;
  why?: string;
  action?: { kind: string; params: Record<string, unknown> };
  href?: string;
  blocked?: string;
}

export interface Briefing {
  greeting: string;
  attention: Line[];
  highlights: Line[];
  recommendations: Recommendation[];
  allClear: boolean;
}

interface Prepared {
  id: string;
  preview: { title: string; summary: string; changes: { label: string; before: string; after: string }[]; note?: string };
}

type Step =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "preview"; prepared: Prepared }
  | { state: "done"; message: string; href?: string }
  | { state: "error"; message: string };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json?.ok) throw new Error(json?.error ?? "Something went wrong — nothing was changed.");
  return json.data;
}

/** One suggestion: [Preview change] → preview → [Apply] / [Not now]. Nothing changes before Apply. */
function RecommendationCard({ rec, onApplied }: { rec: Recommendation; onApplied: () => void }) {
  const [step, setStep] = useState<Step>({ state: "idle" });

  async function preview() {
    setStep({ state: "busy" });
    try {
      const data = await post("/api/dashboard/buddy/actions", rec.action);
      setStep({ state: "preview", prepared: data.action as Prepared });
    } catch (e) {
      setStep({ state: "error", message: (e as Error).message });
    }
  }

  async function apply(prepared: Prepared) {
    setStep({ state: "busy" });
    try {
      const data = await post(`/api/dashboard/buddy/actions/${prepared.id}/apply`, { confirm: true });
      setStep({ state: "done", message: data.result.message, href: data.result.href });
      onApplied();
    } catch (e) {
      setStep({ state: "error", message: (e as Error).message });
    }
  }

  async function notNow(prepared: Prepared) {
    setStep({ state: "idle" });
    await post(`/api/dashboard/buddy/actions/${prepared.id}/cancel`, {}).catch(() => {});
  }

  return (
    <li className={styles.suggest}>
      <div className={styles.recBody}>
        <span className={styles.itemTitle}>{rec.text}</span>
        {rec.why && <span className={styles.itemMessage}>{rec.why}</span>}

        {step.state === "preview" && (
          <div className={styles.preview} role="region" aria-label="Preview of the change">
            <strong>{step.prepared.preview.title}</strong>
            <span className={styles.itemMessage}>{step.prepared.preview.summary}</span>
            {step.prepared.preview.changes.map((c) => (
              <dl key={c.label} className={styles.change}>
                <dt>{c.label}</dt>
                <dd>
                  <span className={styles.before}>Now: {c.before}</span>
                  <span>After: {c.after}</span>
                </dd>
              </dl>
            ))}
            {step.prepared.preview.note && <span className={styles.itemMessage}>{step.prepared.preview.note}</span>}
          </div>
        )}

        {step.state === "done" && (
          <p className={styles.done} role="status">
            {step.message} {step.href && <Link href={step.href}>Open it</Link>}
          </p>
        )}
        {step.state === "error" && (
          <p className={styles.error} role="alert">
            {step.message}
          </p>
        )}

        <div className={styles.recActions}>
          {rec.action && (step.state === "idle" || step.state === "error") && (
            <button type="button" className={styles.send} onClick={preview} aria-label={`Preview change: ${rec.text}`}>
              Preview change
            </button>
          )}
          {step.state === "busy" && <span className={styles.muted}>One moment…</span>}
          {step.state === "preview" && (
            <>
              <button type="button" className={styles.send} onClick={() => apply(step.prepared)} aria-label={`Apply: ${step.prepared.preview.title}`}>
                Apply
              </button>
              <button type="button" className={styles.secondary} onClick={() => notNow(step.prepared)} aria-label={`Not now: ${step.prepared.preview.title}`}>
                Not now
              </button>
            </>
          )}
          {!rec.action && rec.href && (
            <Link href={rec.href} className={styles.secondary}>
              Go there
            </Link>
          )}
          {rec.blocked && <span className={styles.itemMessage}>{rec.blocked}</span>}
        </div>
      </div>
    </li>
  );
}

function Lines({ lines, tone }: { lines: Line[]; tone: "warn" | "suggest" }) {
  return (
    <ul className={styles.list}>
      {lines.map((l) => (
        <li key={l.key} className={tone === "warn" ? styles.warn : styles.suggest}>
          {l.href ? (
            <Link href={l.href} className={styles.itemLink}>
              <span className={styles.itemMessage}>{l.text}</span>
            </Link>
          ) : (
            <span className={styles.itemLink}>{l.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The buddy's "Today" view: what's happening, what needs attention, what to
 * do next. Everything shown was already limited on the server to what this
 * person's role may see; suggestions only carry a button when they may act.
 */
export default function BuddyToday({ briefing }: { briefing: Briefing | null }) {
  const router = useRouter();
  if (!briefing) return <p className={styles.muted}>Checking your business…</p>;

  return (
    <div className={styles.today}>
      <p className={styles.greeting}>{briefing.greeting}</p>
      {briefing.allClear && briefing.highlights.length === 0 && <p className={styles.muted}>Looking good — nothing needs you right now.</p>}
      {briefing.attention.length > 0 && (
        <section aria-label="Needs attention">
          <p className={styles.sectionLabel}>Needs attention</p>
          <Lines lines={briefing.attention} tone="warn" />
        </section>
      )}
      {briefing.highlights.length > 0 && (
        <section aria-label="What's happening">
          <p className={styles.sectionLabel}>What&apos;s happening</p>
          <Lines lines={briefing.highlights} tone="suggest" />
        </section>
      )}
      {briefing.recommendations.length > 0 && (
        <section aria-label="Recommended next">
          <p className={styles.sectionLabel}>Recommended next</p>
          <ul className={styles.list}>
            {briefing.recommendations.map((r) => (
              <RecommendationCard
                key={r.key}
                rec={r}
                // Refresh the page behind the dock; the card keeps showing its result.
                onApplied={() => router.refresh()}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
