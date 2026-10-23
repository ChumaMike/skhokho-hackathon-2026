import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorised, cronSecretConfigured } from '@/lib/cron/auth'
import { reconcileUnconfirmedAttempts } from '@/modules/payments/payment-attempt.service'
import { runJob } from '@/modules/platform-admin/jobs'

export const runtime = 'nodejs'

/**
 * Payment reconciliation (vercel.json crons): customer payments PayFast
 * never confirmed are expired and surfaced to the merchant to check. A
 * notification that still arrives later settles as normal.
 */
export async function GET(req: NextRequest) {
  if (!cronSecretConfigured()) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  if (!cronAuthorised(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const r = await runJob('manual.payments', () => reconcileUnconfirmedAttempts())
  return NextResponse.json(r, { status: r.ok ? 200 : 500 })
}
