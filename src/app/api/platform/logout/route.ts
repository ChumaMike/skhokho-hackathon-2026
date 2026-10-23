import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME } from '@/modules/auth/auth.service'

export const runtime = 'nodejs'

/** Clears the owner session cookie set by /api/platform/login. */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/login', req.url), 303)
  res.cookies.delete(COOKIE_NAME.staff)
  return res
}
