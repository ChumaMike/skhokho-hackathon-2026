/**
 * BulkSMS adapter and the metering helpers — all with a fake HTTP client, so
 * the suite needs no BulkSMS account, no credentials and sends no real text.
 *
 * What is worth pinning here, rather than only the happy path:
 *   - the request we actually put on the wire (a wrong field name fails
 *     silently in production and costs nothing but delivers nothing);
 *   - every failure mapping, because the seam's contract is that a provider
 *     NEVER throws and only acceptance counts as sent;
 *   - that no error path can leak the number or the message body, which is the
 *     promise src/lib/messaging/provider.ts makes;
 *   - the South African day boundary, which is the one piece of arithmetic in
 *     the cap that can be quietly wrong for two hours a day.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createBulkSmsProvider,
  bulkSmsCredentialsFromEnv,
  __readResponseForTests as readResponse,
  type FetchLike,
} from './providers/sms-bulksms'
import { startOfSaDay, dailyCap, DEFAULT_DAILY_CAP } from './message-log'

const CREDS = { tokenId: 'tok-id', tokenSecret: 'tok-secret', sender: null }

/** A fake that records what it was called with and returns what you tell it. */
function fakeFetch(status: number, body: string) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = []
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return { status, async text() { return body } }
  }
  return { impl, calls }
}

/**
 * Restores an environment variable to exactly what it was — including the
 * case where it was unset, which `process.env.X = undefined` would turn into
 * the string "undefined" and quietly break the next test.
 */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const ONE_MESSAGE = (over: Record<string, unknown> = {}) =>
  JSON.stringify([{ id: '446132345', status: { id: 'ACCEPTED.null', type: 'ACCEPTED', subtype: null }, creditCost: 0.3, ...over }])

/* ---------------------------------------------------------------------------
 * The request on the wire
 * ------------------------------------------------------------------------ */

test('sends to the BulkSMS messages endpoint with the token pair as basic auth', async () => {
  const { impl, calls } = fakeFetch(201, ONE_MESSAGE())
  const provider = createBulkSmsProvider(CREDS, impl)
  await provider.send({ to: '+27821234567', text: 'Your code is 123456', kind: 'customer_login_code' })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.bulksms.com/v1/messages')
  assert.equal(calls[0].init.method, 'POST')
  // Basic base64("tok-id:tok-secret") — pinned so a change in how the pair is
  // combined cannot pass unnoticed.
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('tok-id:tok-secret').toString('base64')}`)
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
})

test('the body uses BulkSMS field names, and omits the sender when there is none', async () => {
  const { impl, calls } = fakeFetch(201, ONE_MESSAGE())
  await createBulkSmsProvider(CREDS, impl).send({ to: '+27821234567', text: 'hello', kind: 'unspecified' })

  const body = JSON.parse(calls[0].init.body) as Record<string, unknown>
  assert.deepEqual(body, { to: '+27821234567', body: 'hello' })
  assert.equal('from' in body, false)
})

test('an approved sender id is sent as `from`', async () => {
  const { impl, calls } = fakeFetch(201, ONE_MESSAGE())
  await createBulkSmsProvider({ ...CREDS, sender: 'Skhokho' }, impl).send({ to: '+27821234567', text: 'hi', kind: 'unspecified' })
  assert.equal((JSON.parse(calls[0].init.body) as { from?: string }).from, 'Skhokho')
})

test('the number is passed through in E.164, exactly as the seam normalised it', async () => {
  const { impl, calls } = fakeFetch(201, ONE_MESSAGE())
  await createBulkSmsProvider(CREDS, impl).send({ to: '+27821234567', text: 'hi', kind: 'unspecified' })
  assert.equal((JSON.parse(calls[0].init.body) as { to: string }).to, '+27821234567')
})

/* ---------------------------------------------------------------------------
 * Reading the answer
 * ------------------------------------------------------------------------ */

test('an accepted message returns the provider id and the credit cost', () => {
  const r = readResponse(201, ONE_MESSAGE())
  assert.equal(r.accepted, true)
  assert.equal(r.providerId, '446132345')
  assert.equal(r.costCredits, 0.3)
})

test('every BulkSMS status that means "the provider has it" counts as accepted', () => {
  // The published enum is ACCEPTED, SCHEDULED, SENT, DELIVERED, UNKNOWN, FAILED.
  for (const type of ['ACCEPTED', 'SCHEDULED', 'SENT', 'DELIVERED']) {
    const r = readResponse(201, ONE_MESSAGE({ status: { type } }))
    assert.equal(r.accepted, true, `${type} should be accepted`)
  }
})

test('FAILED is never counted as sent, and says which status refused it', () => {
  const r = readResponse(201, ONE_MESSAGE({ status: { type: 'FAILED' } }))
  assert.equal(r.accepted, false)
  assert.equal(r.errorName, 'bulksms_status_failed')
})

test('UNKNOWN is not acceptance — the caller must be free to fall back to email', () => {
  const r = readResponse(201, ONE_MESSAGE({ status: { type: 'UNKNOWN' } }))
  assert.equal(r.accepted, false)
  assert.equal(r.errorName, 'bulksms_status_unknown')
})

test('a 2xx with no status at all is still acceptance — the carrier has it', () => {
  const r = readResponse(201, JSON.stringify([{ id: 'x1' }]))
  assert.equal(r.accepted, true)
  assert.equal(r.providerId, 'x1')
  assert.equal(r.costCredits, null)
})

test('bad credentials and rate limiting are distinguishable, because the fixes differ', () => {
  assert.equal(readResponse(401, '{}').errorName, 'bulksms_auth_rejected')
  assert.equal(readResponse(403, '{}').errorName, 'bulksms_auth_rejected')
  assert.equal(readResponse(429, '{}').errorName, 'bulksms_rate_limited')
  assert.equal(readResponse(401, '{}').accepted, false)
})

test('any other non-2xx keeps the status code in the error name', () => {
  assert.equal(readResponse(500, 'upstream exploded').errorName, 'bulksms_http_500')
  assert.equal(readResponse(400, '{"detail":"bad number"}').errorName, 'bulksms_http_400')
})

test('a body that is not JSON, or an empty array, fails rather than claiming a send', () => {
  assert.equal(readResponse(201, '<html>maintenance</html>').errorName, 'bulksms_unreadable_response')
  assert.equal(readResponse(201, '[]').errorName, 'bulksms_empty_response')
  assert.equal(readResponse(201, '[]').accepted, false)
})

test('a non-numeric creditCost is recorded as unknown, never coerced to a number', () => {
  assert.equal(readResponse(201, ONE_MESSAGE({ creditCost: 'lots' })).costCredits, null)
  assert.equal(readResponse(201, ONE_MESSAGE({ creditCost: null })).costCredits, null)
})

/* ---------------------------------------------------------------------------
 * Never throws, never leaks
 * ------------------------------------------------------------------------ */

test('a network failure is reported, not thrown', async () => {
  const impl: FetchLike = async () => {
    throw new Error('ECONNREFUSED 1.2.3.4:443')
  }
  const r = await createBulkSmsProvider(CREDS, impl).send({ to: '+27821234567', text: 'hi', kind: 'unspecified' })
  assert.equal(r.accepted, false)
  assert.equal(r.errorName, 'bulksms_unreachable')
})

test('a timeout is its own error name, so a slow provider is distinguishable from a dead one', async () => {
  const impl: FetchLike = async () => {
    const e = new Error('aborted')
    e.name = 'AbortError'
    throw e
  }
  const r = await createBulkSmsProvider(CREDS, impl).send({ to: '+27821234567', text: 'hi', kind: 'unspecified' })
  assert.equal(r.errorName, 'bulksms_timeout')
})

test('no failure path returns the number, the body or the credentials', async () => {
  const secret = 'Your code is 123456'
  const cases: FetchLike[] = [
    async () => { throw new Error(`failed to POST +27821234567 body=${secret}`) },
    async () => ({ status: 500, async text() { return `rejected: ${secret} to +27821234567` } }),
    async () => ({ status: 401, async text() { return 'tok-secret is invalid' } }),
  ]
  for (const impl of cases) {
    const r = await createBulkSmsProvider(CREDS, impl).send({ to: '+27821234567', text: secret, kind: 'customer_login_code' })
    const serialised = JSON.stringify(r)
    assert.equal(serialised.includes('27821234567'), false, `leaked the number: ${serialised}`)
    assert.equal(serialised.includes('123456'), false, `leaked the message: ${serialised}`)
    assert.equal(serialised.includes('tok-secret'), false, `leaked the credentials: ${serialised}`)
  }
})

/* ---------------------------------------------------------------------------
 * Credentials from the environment
 * ------------------------------------------------------------------------ */

test('half a token pair reads as unconfigured, so it cannot fail on every send', () => {
  const saved = { id: process.env.BULKSMS_TOKEN_ID, secret: process.env.BULKSMS_TOKEN_SECRET, sender: process.env.BULKSMS_SENDER }
  try {
    process.env.BULKSMS_TOKEN_ID = 'only-the-id'
    delete process.env.BULKSMS_TOKEN_SECRET
    assert.equal(bulkSmsCredentialsFromEnv(), null)

    process.env.BULKSMS_TOKEN_SECRET = 'and-the-secret'
    const c = bulkSmsCredentialsFromEnv()
    assert.equal(c?.tokenId, 'only-the-id')
    assert.equal(c?.sender, null, 'an unset sender is null, not an empty string')

    process.env.BULKSMS_SENDER = '   '
    assert.equal(bulkSmsCredentialsFromEnv()?.sender, null, 'whitespace is not a sender id')
  } finally {
    restoreEnv('BULKSMS_TOKEN_ID', saved.id)
    restoreEnv('BULKSMS_TOKEN_SECRET', saved.secret)
    restoreEnv('BULKSMS_SENDER', saved.sender)
  }
})

/* ---------------------------------------------------------------------------
 * The cap's arithmetic
 * ------------------------------------------------------------------------ */

test('the daily cap resets at midnight South African time, not at UTC midnight', () => {
  // 21:30 UTC on 1 March is 23:30 SAST the SAME day, so the day started at
  // 22:00 UTC on 28 February. Getting this wrong would reset every shop's
  // allowance at 02:00 in the morning.
  assert.equal(startOfSaDay(new Date('2026-03-01T21:30:00Z')).toISOString(), '2026-02-28T22:00:00.000Z')
  // 00:30 UTC on 1 March is already 02:30 SAST on 1 March.
  assert.equal(startOfSaDay(new Date('2026-03-01T00:30:00Z')).toISOString(), '2026-02-28T22:00:00.000Z')
  // 22:00 UTC is exactly the start of the next SA day.
  assert.equal(startOfSaDay(new Date('2026-03-01T22:00:00Z')).toISOString(), '2026-03-01T22:00:00.000Z')
})

test('the SA day boundary holds across a month end and a leap February', () => {
  assert.equal(startOfSaDay(new Date('2024-02-29T05:00:00Z')).toISOString(), '2024-02-28T22:00:00.000Z')
  assert.equal(startOfSaDay(new Date('2026-01-01T01:00:00Z')).toISOString(), '2025-12-31T22:00:00.000Z')
})

test('a malformed cap falls back to the default instead of silencing the platform', () => {
  const saved = process.env.SMS_DAILY_CAP_PER_BUSINESS
  try {
    for (const bad of ['', 'five hundred', '-1', '12.5']) {
      process.env.SMS_DAILY_CAP_PER_BUSINESS = bad
      assert.equal(dailyCap(), DEFAULT_DAILY_CAP, `"${bad}" should fall back`)
    }
    // Zero is a deliberate setting, not a mistake: it stops every text.
    process.env.SMS_DAILY_CAP_PER_BUSINESS = '0'
    assert.equal(dailyCap(), 0)
    process.env.SMS_DAILY_CAP_PER_BUSINESS = '1200'
    assert.equal(dailyCap(), 1200)
  } finally {
    restoreEnv('SMS_DAILY_CAP_PER_BUSINESS', saved)
  }
})
