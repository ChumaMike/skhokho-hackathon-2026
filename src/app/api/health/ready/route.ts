import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Readiness: can this instance serve real requests (database reachable)?
 * 503 when not. Reports only up/down — never connection strings, versions
 * or error details.
 */
export async function GET() {
  const started = Date.now()
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000)),
    ])
    return NextResponse.json({ ok: true, database: 'up', ms: Date.now() - started }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    console.error('[health/ready] database check failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, database: 'down' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
