import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without the secret
 * configured, cron routes refuse to run rather than run unauthenticated.
 */
export function cronSecretConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET)
}

export function cronAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
