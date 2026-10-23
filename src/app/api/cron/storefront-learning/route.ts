import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorised, cronSecretConfigured } from '@/lib/cron/auth'
import { purgeExpiredStorefrontStats } from '@/modules/storefront-learning/retention'
import { runPatternDetection } from '@/modules/storefront-learning/patterns'
import { runJob } from '@/modules/platform-admin/jobs'

export const runtime = 'nodejs'

/**
 * Daily storefront-learning maintenance (vercel.json crons):
 *  - deletes storefront counters past their retention period;
 *  - re-runs pattern detection. New patterns land as CANDIDATES only —
 *    nothing reaches a merchant until a platform admin approves it.
 */
export async function GET(req: NextRequest) {
  if (!cronSecretConfigured()) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  if (!cronAuthorised(req)) return NextResponse.json({ ok: false }, { status: 401 })

  const now = new Date()
  // Recorded like the scheduled run (job_runs + SYSTEM event on failure), so a manual run is never invisible.
  const purged = await runJob('manual.storefrontStats', () => purgeExpiredStorefrontStats(now))
  const detection = await runJob('manual.storefrontPatterns', () => runPatternDetection(now))
  const ok = purged.ok && detection.ok
  return NextResponse.json({ ok, purged, detection }, { status: ok ? 200 : 500 })
}
