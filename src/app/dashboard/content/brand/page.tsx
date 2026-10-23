import Link from "next/link";
import { prisma } from "@/lib/prisma/client";
import { contentGate } from "../gate";
import ContentShell from "../ContentShell";
import { getBrandProfile } from "@/modules/content/brand-profile";
import { saveBrandAction } from "../actions";
import styles from "../content.module.css";

export const dynamic = "force-dynamic";

/** The marketing voice. Name, logo, description and contact details are edited where they live (Storefront); this adds only what the AI has no other way to know. */
export default async function BrandPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const gate = await contentGate();
  const sp = await searchParams;
  const business = gate.permitted && gate.entitled ? await prisma.business.findUniqueOrThrow({ where: { id: gate.actor.tenantId }, select: { name: true, description: true, logoUrl: true, settings: true } }) : null;
  const brand = business ? getBrandProfile(business) : null;

  return (
    <ContentShell gate={gate} current="brand" title="Brand profile" lede="How the business sounds. Every AI draft uses this automatically.">
      {sp.ok && <div className="successBanner">{sp.ok}</div>}
      {sp.err && <div className="errorBanner" role="alert">{sp.err}</div>}
      {business && brand && (
        <>
          <div className={`card ${styles.panel}`}>
            <h2 className={styles.h2}>Already on file</h2>
            <p>
              <strong>{business.name}</strong>
              {business.description ? ` — ${business.description}` : " — no description yet"}
              {business.logoUrl ? " · logo set" : " · no logo"}
              {brand.storefrontVoiceTone ? ` · storefront tone: ${brand.storefrontVoiceTone.toLowerCase()}` : ""}
            </p>
            <p className={styles.muted}>
              Edit these under <Link href="/dashboard/storefront">Storefront</Link> — they are not duplicated here. Products and prices come straight from your <Link href="/dashboard/catalog">catalogue</Link>.
            </p>
          </div>

          <form action={saveBrandAction} className={`card ${styles.form}`}>
            <label>
              Voice — how you talk to customers
              <input name="voice" className="input" maxLength={160} defaultValue={brand.voice ?? ""} placeholder="e.g. friendly and local, like a neighbour; a bit of Zulu now and then" />
            </label>
            <label>
              Who you&apos;re talking to
              <input name="audience" className="input" maxLength={200} defaultValue={brand.audience ?? ""} placeholder="e.g. families and students around Orlando West" />
            </label>
            <label>
              Personality
              <input name="personality" className="input" maxLength={160} defaultValue={brand.personality ?? ""} placeholder="e.g. proud, generous portions, always on time" />
            </label>
            <label>
              Phrases you like (one per line or comma-separated)
              <textarea name="preferredPhrases" className="input" style={{ minHeight: 70 }} defaultValue={brand.preferredPhrases.join("\n")} placeholder={"Sharp sharp\nMade fresh daily"} />
            </label>
            <label>
              Phrases or topics to avoid
              <textarea name="avoidPhrases" className="input" style={{ minHeight: 70 }} defaultValue={brand.avoidPhrases.join("\n")} placeholder={"cheap\ncompetitor names"} />
            </label>
            <label>
              Default call to action
              <input name="defaultCta" className="input" maxLength={80} defaultValue={brand.defaultCta ?? ""} placeholder="e.g. Order on WhatsApp before 11" />
            </label>
            <div className={styles.actions}>
              <button type="submit" className="btn btnPrimary">Save brand profile</button>
            </div>
          </form>
        </>
      )}
    </ContentShell>
  );
}
