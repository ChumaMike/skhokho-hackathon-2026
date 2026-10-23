import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME } from '@/modules/auth/auth.service'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/driver/login', req.url), 303)
  res.cookies.set(COOKIE_NAME.driver, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
