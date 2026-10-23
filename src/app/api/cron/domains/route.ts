import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorised, cronSecretConfigured } from '@/lib/cron/auth'
import { runDomainMaintenance } from '@/modules/domains/maintenance'
import { runJob } from '@/modules/platform-admin/jobs'

export const runtime = 'nodejs'

/** Domain maintenance on demand. Scheduled runs go through /api/cron/daily. */
export async function GET(req: NextRequest) {
  if (!cronSecretConfigured()) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  if (!cronAuthorised(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const r = await runJob('manual.domains', () => runDomainMaintenance())
  return NextResponse.json(r, { status: r.ok ? 200 : 500 })
}
