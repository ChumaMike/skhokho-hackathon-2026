/**
 * BulkSMS delivery reports.
 *
 * BulkSMS calls this with `X-BulkSMS-Event: status-report` and a JSON ARRAY of
 * message objects — the same shape the List Messages call returns — each
 * carrying `id` and a nested `status` of the form
 * `{ id: "DELIVERED.null", type: "DELIVERED", subtype: null }`.
 *
 * ON AUTHENTICITY, PLAINLY: BulkSMS publishes no signature and no HMAC for
 * webhooks. Its own guidance is a secret in the URL, and it warns that source
 * IPs change without notice so an allowlist is not a dependable control. So
 * the only verification available is a shared token, compared in constant
 * time, and this route requires one — it is NOT signature verification and
 * must not be described as such anywhere. What follows from that:
 *
 *   - the token is a bearer secret in a URL, so it will sit in BulkSMS's
 *     configuration and possibly in their logs; it is rotatable and grants
 *     nothing except the ability to mark messages delivered;
 *   - this endpoint therefore only ever moves a status forward and never
 *     reveals whether an id existed (see below), so a leaked token buys an
 *     attacker nothing worth having;
 *   - with no signature, a report can never be treated as authority for
 *     anything that costs money or grants access. It updates a log, nothing
 *     more. Deliberately: that is why delivery state lives in its own column
 *     and is not wired to refunds, retries or entitlements.
 *
 * Always answers 200 to an authenticated call, even for an id we do not know.
 * Two reasons: a 404 would turn the endpoint into an oracle for guessing
 * message ids, and BulkSMS retries non-2xx (X-BulkSMS-Delivery-Attempt), so a
 * report for a message sent before this table existed would retry forever.
 */

import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { applyDeliveryReport } from '@/lib/messaging/message-log'
import { log } from '@/lib/log'

export const runtime = 'nodejs'

/** Status types that mean the handset got it. The rest are a non-delivery. */
const DELIVERED_TYPES = new Set(['DELIVERED'])
/** Types that are still in flight — no verdict yet, so leave the row alone. */
const PENDING_TYPES = new Set(['ACCEPTED', 'SCHEDULED', 'SENT', 'UNKNOWN'])

function tokenConfigured(): boolean {
  return Boolean((process.env.BULKSMS_WEBHOOK_TOKEN ?? '').trim())
}

/**
 * Accepts the token from `?secret=` (BulkSMS's own suggestion) or from an
 * `Authorization: Bearer` header, whichever the account is configured with.
 * Constant-time compare, and a length check first because timingSafeEqual
 * throws on a length mismatch.
 */
function authorised(req: NextRequest): boolean {
  const expectedRaw = (process.env.BULKSMS_WEBHOOK_TOKEN ?? '').trim()
  if (!expectedRaw) return false
  const expected = Buffer.from(expectedRaw)

  const fromQuery = new URL(req.url).searchParams.get('secret')
  const header = req.headers.get('authorization') ?? ''
  const fromHeader = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null

  for (const candidate of [fromQuery, fromHeader]) {
    if (candidate == null) continue
    const given = Buffer.from(candidate)
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true
  }
  return false
}

interface ReportedMessage {
  id?: unknown
  status?: { type?: unknown } | null
}

export async function POST(req: NextRequest) {
  // Refuses rather than running unauthenticated, same stance as the cron routes.
  if (!tokenConfigured()) {
    return NextResponse.json({ ok: false, error: 'BULKSMS_WEBHOOK_TOKEN not configured' }, { status: 503 })
  }
  if (!authorised(req)) {
    // No detail: an error that distinguishes "wrong token" from "no token"
    // helps nobody but someone guessing.
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'unreadable body' }, { status: 400 })
  }

  // The documented body is an array; a single object is accepted too so a
  // change at the vendor cannot silently drop every report.
  const items: ReportedMessage[] = Array.isArray(payload)
    ? (payload as ReportedMessage[])
    : payload && typeof payload === 'object'
      ? [payload as ReportedMessage]
      : []

  let applied = 0
  let pending = 0
  let unmatched = 0

  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id : item?.id == null ? null : String(item.id)
    const type = typeof item?.status?.type === 'string' ? item.status.type.toUpperCase() : null
    if (!id || !type) continue

    // Still on its way: a status report can arrive for an intermediate state,
    // and overwriting ACCEPTED with ACCEPTED would just churn the row.
    if (PENDING_TYPES.has(type)) {
      pending += 1
      continue
    }

    const changed = await applyDeliveryReport({
      providerMessageId: id,
      delivered: DELIVERED_TYPES.has(type),
      errorName: DELIVERED_TYPES.has(type) ? null : `bulksms_${type.toLowerCase()}`,
    })
    if (changed) applied += 1
    else unmatched += 1
  }

  // Counts only — never an id, a number or a body.
  log('info', 'bulksms.delivery_report', {
    received: items.length,
    applied,
    pending,
    unmatched,
    attempt: req.headers.get('x-bulksms-delivery-attempt'),
    event: req.headers.get('x-bulksms-event'),
  })

  // 200 regardless, so BulkSMS stops retrying and learns nothing about which
  // ids we hold.
  return NextResponse.json({ ok: true, received: items.length }, { status: 200 })
}
