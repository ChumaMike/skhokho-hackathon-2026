import { NextResponse } from 'next/server'
import { COOKIE_NAME } from '@/modules/auth/auth.service'

export const runtime = 'nodejs'

/** Ends the customer session only — an owner/staff/driver cookie on the same browser is untouched. */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(COOKIE_NAME.customer)
  return res
}
