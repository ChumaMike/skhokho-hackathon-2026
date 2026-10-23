import { prisma } from '@/lib/prisma/client'
import styles from './register.module.css'
import HoneypotField from "@/components/HoneypotField";

export const dynamic = 'force-dynamic'

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ code?: string; err?: string; platform?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams

  // ACTIVE only — an unpublished or suspended business's name must not be
  // revealed (or its loyalty card opened) through a guessed slug.
  const business = await prisma.business.findFirst({
    where: { slug, status: 'ACTIVE' },
    select: { name: true, active: true },
  })

  if (!business) {
    return (
      <main className="shell">
        <div className="column">
          <p className={styles.empty}>
            We couldn&apos;t find that shop. Check the link and try again.
          </p>
        </div>
      </main>
    )
  }

  if (sp.code) {
    return (
      <main className="shell">
        <div className="column">
          <div className={styles.done}>
            <span className="eyebrow">You&apos;re in</span>
            <h1 className={styles.doneTitle}>Your card is open at {business.name}</h1>
            <p className={styles.doneNote}>Your loyalty code</p>
            <div className={styles.code}>{sp.code}</div>
            <p className={styles.doneNote}>
              Read this out at the counter to collect your stamps.
            </p>
            {sp.platform === '1' && (
              <p className={styles.crossShop}>
                You also chose to link your rewards across Skhokho shops. That
                switches on once the regulator clears it — your choice is recorded
                until then.
              </p>
            )}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="shell">
      <form method="post" action="/api/platform/register">
        <HoneypotField />
        <div className="column">
          <span className="eyebrow">{business.name}</span>
          <h1 className={styles.title}>Start your rewards card</h1>
          <p className={styles.lede}>
            Add your number and earn a stamp every visit.
          </p>

          <input type="hidden" name="slug" value={slug} />

          {sp.err && <div className="errorBanner">{sp.err}</div>}

          <label className="field">
            <span className="label">WhatsApp number</span>
            <input
              className="input"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="082 123 4567"
              required
            />
          </label>

          <label className="field">
            <span className="label">Your name (optional)</span>
            <input className="input" name="name" autoComplete="given-name" />
          </label>


          <p className={styles.privacy}>
            Your number stays private. {business.name} only sees what you enter here.
          </p>
        </div>

        <div className="bottomBar">
          <div className="bottomBarInner">
            <button type="submit" className="btn btnPrimary btnBlock">
              Start my card
            </button>
          </div>
        </div>
      </form>
    </main>
  )
}
