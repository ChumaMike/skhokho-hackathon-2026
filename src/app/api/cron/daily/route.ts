import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorised, cronSecretConfigured } from '@/lib/cron/auth'
import { runDomainMaintenance } from '@/modules/domains/maintenance'
import { purgeExpiredStorefrontStats } from '@/modules/storefront-learning/retention'
import { runPatternDetection } from '@/modules/storefront-learning/patterns'
import { reconcileUnconfirmedAttempts } from '@/modules/payments/payment-attempt.service'
import { purgeRateLimitBuckets } from '@/lib/rate-limit'
import { runJob } from '@/modules/platform-admin/jobs'
import { tickDispatch } from '@/modules/skhokholetha/dispatch.service'
import { releaseDueEarnings } from '@/modules/skhokholetha/ledger.service'
import { purgeExpiredLoginCodes } from '@/modules/customers/customer-auth.service'
import { runBillingMaintenance, generateRenewalDrafts } from '@/modules/billing/lifecycle.service'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * The one scheduled job (vercel.json crons). Each task runs on its own: a
 * failure in one is reported and never stops the others. The individual
 * /api/cron/* routes stay available for running one task by hand.
 */
const TASKS: Record<string, (now: Date) => Promise<unknown>> = {
  payments: (now) => reconcileUnconfirmedAttempts(now),
  domains: (now) => runDomainMaintenance(now),
  storefrontStats: (now) => purgeExpiredStorefrontStats(now),
  storefrontPatterns: (now) => runPatternDetection(now),
  rateLimits: (now) => purgeRateLimitBuckets(now),
  // Customer sign-in codes live ten minutes; the rows carry a phone/email and go a day later.
  customerLoginCodes: (now) => purgeExpiredLoginCodes(now),
  // Skhokholetha: dispatch also advances on every driver/shop poll; this is the backstop.
  deliveryDispatch: (now) => tickDispatch(now, 100),
  driverEarnings: (now) => releaseDueEarnings(now),
  // Platform billing (merchant -> Skhokho Laboratory). Entirely separate from
  // `payments` above, which reconciles a merchant's own customer payments.
  // Phase A performs no card retries: it expires trials, sends the dunning
  // notices and ends grace. Drafts run after, so a renewal invoice exists
  // before the period it covers begins.
  platformBilling: (now) => runBillingMaintenance(now),
  platformBillingDrafts: (now) => generateRenewalDrafts(now),
}

export async function GET(req: NextRequest) {
  if (!cronSecretConfigured()) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  if (!cronAuthorised(req)) return NextResponse.json({ ok: false }, { status: 401 })

  const now = new Date()
  const results: Record<string, { ok: boolean; result?: unknown; error?: string }> = {}
  // Each task is its own job run (job_runs + SYSTEM event on failure); one failing never stops the rest.
  for (const [name, task] of Object.entries(TASKS)) results[name] = await runJob(`daily.${name}`, () => task(now))
  const ok = Object.values(results).every((r) => r.ok)
  // Non-200 when anything failed, so the cron run shows as failed in Vercel.
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 500 })
}
