/**
 * Shared helpers for the Skhokholetha route handlers: one error → response
 * mapping, so every route answers the same way and never leaks internals.
 */

import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AuthError } from '@/lib/auth/guards'
import { DriverError } from './driver.service'
import { NetworkDeliveryError } from './delivery.service'
import { OfferUnavailableError } from './dispatch.service'
import { InvalidTransitionError } from './state-machine'
import { LedgerError } from './ledger.service'
import { FeatureDisabledError } from './flags'

export function lethaError(e: unknown): NextResponse {
  if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status })
  if (e instanceof FeatureDisabledError) return NextResponse.json({ ok: false, error: e.message, code: 'FEATURE_DISABLED' }, { status: 403 })
  if (e instanceof OfferUnavailableError) return NextResponse.json({ ok: false, error: e.message, code: 'OFFER_UNAVAILABLE' }, { status: 409 })
  if (e instanceof InvalidTransitionError) return NextResponse.json({ ok: false, error: "That step isn't possible right now.", code: 'INVALID_TRANSITION' }, { status: 409 })
  if (e instanceof NetworkDeliveryError) {
    const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'RATE_LIMITED' ? 429 : 422
    return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status })
  }
  if (e instanceof DriverError || e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 422 })
  if (e instanceof ZodError) return NextResponse.json({ ok: false, error: 'Some details were not valid.' }, { status: 400 })
  console.error('[skhokholetha] unexpected error:', e instanceof Error ? e.message : e)
  return NextResponse.json({ ok: false, error: 'Something went wrong on our side.' }, { status: 500 })
}
