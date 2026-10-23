import { NextRequest, NextResponse } from 'next/server'
import { clearAdminCookies } from '@/modules/platform-admin/session'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/admin-login', req.url), 303)
  clearAdminCookies(res)
  return res
}
