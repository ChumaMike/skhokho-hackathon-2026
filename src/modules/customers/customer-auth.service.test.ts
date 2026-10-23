import test from 'node:test'
import assert from 'node:assert/strict'
import { CODE_LENGTH, customerSessionCookie, generateLoginCode, hashLoginCode, loginCodeText, parseLoginIdentifier } from './customer-auth.service'
import { COOKIE_NAME, signToken, verifyToken } from '@/modules/auth/auth.service'
import { crossBusinessLinkingEnabled, requireCrossBusinessLinking } from './cross-business'

/** Pure parts of customer sign-in — no database. The code flow itself is customer-login.db.test.ts. */

test('what the customer typed resolves to one canonical identifier, or nothing', () => {
  assert.deepEqual(parseLoginIdentifier(' 082 123 4567 '), { channel: 'phone', identifier: '+27821234567' })
  assert.deepEqual(parseLoginIdentifier('+27 72 000 1111'), { channel: 'phone', identifier: '+27720001111' })
  assert.deepEqual(parseLoginIdentifier('Thandi@Example.CO.ZA'), { channel: 'email', identifier: 'thandi@example.co.za' })
  assert.equal(parseLoginIdentifier('011 123 4567'), null, 'landlines cannot receive a code')
  assert.equal(parseLoginIdentifier('not an email@'), null)
  assert.equal(parseLoginIdentifier(''), null)
})

test('codes are six digits, hashed with the row as salt, and the message carries the code and the shop', () => {
  for (let i = 0; i < 50; i++) assert.match(generateLoginCode(), new RegExp(`^\\d{${CODE_LENGTH}}$`))
  assert.equal(hashLoginCode('row-a', '123456'), hashLoginCode('row-a', '123456'))
  assert.notEqual(hashLoginCode('row-a', '123456'), hashLoginCode('row-b', '123456'), 'the same code at two rows must not hash alike')
  assert.notEqual(hashLoginCode('row-a', '123456'), hashLoginCode('row-a', '123457'))
  const text = loginCodeText('123456', 'Kota Kings')
  assert.ok(text.includes('123456') && text.includes('Kota Kings') && text.includes('10 minutes'))
  assert.ok(!/https?:\/\//.test(text), 'nothing to tap: the code is the whole message')
})

test('the customer session is its own token type and its own cookie', async (t) => {
  const original = process.env.JWT_SECRET
  t.after(() => {
    if (original === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = original
  })
  process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long'

  const token = await signToken({ type: 'customer', channel: 'phone', identifier: '+27821234567' })
  const payload = await verifyToken(token)
  assert.deepEqual(payload, { type: 'customer', channel: 'phone', identifier: '+27821234567' })
  assert.ok(!('customerId' in payload) && !JSON.stringify(payload).includes('customer_id'), 'never the global customers.id')

  const cookie = customerSessionCookie()
  assert.equal(cookie.name, COOKIE_NAME.customer)
  const others = [COOKIE_NAME.staff, COOKIE_NAME.driver, COOKIE_NAME.platform_admin, COOKIE_NAME.platform_user, COOKIE_NAME.admin_mfa]
  assert.ok(!others.includes(cookie.name as never), 'a customer never rides an owner, staff, driver or admin cookie')
  assert.equal(cookie.options.httpOnly, true)
  assert.equal(cookie.options.sameSite, 'lax')
})

test('the cross-business layer is off unless the flag is exactly "true"', (t) => {
  const original = process.env.CROSS_BUSINESS_LINKING_ENABLED
  t.after(() => {
    if (original === undefined) delete process.env.CROSS_BUSINESS_LINKING_ENABLED
    else process.env.CROSS_BUSINESS_LINKING_ENABLED = original
  })
  delete process.env.CROSS_BUSINESS_LINKING_ENABLED
  assert.equal(crossBusinessLinkingEnabled(), false)
  assert.throws(() => requireCrossBusinessLinking(), /not available yet/)
  process.env.CROSS_BUSINESS_LINKING_ENABLED = '1'
  assert.equal(crossBusinessLinkingEnabled(), false)
  process.env.CROSS_BUSINESS_LINKING_ENABLED = 'true'
  assert.equal(crossBusinessLinkingEnabled(), true)
  assert.doesNotThrow(() => requireCrossBusinessLinking())
})
