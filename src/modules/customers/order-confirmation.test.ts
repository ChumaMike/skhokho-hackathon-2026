import test from 'node:test'
import assert from 'node:assert/strict'
import { orderEta, readPrepMinutes } from './order-confirmation'

test('prep time is read only when the merchant set a sensible whole number of minutes', () => {
  assert.equal(readPrepMinutes(null), null)
  assert.equal(readPrepMinutes({}), null)
  assert.equal(readPrepMinutes({ ordering: { minOrderCents: 5000 } }), null)
  assert.equal(readPrepMinutes({ ordering: { prepMinutes: 20 } }), 20)
  assert.equal(readPrepMinutes({ ordering: { prepMinutes: 0 } }), null, 'zero means not set')
  assert.equal(readPrepMinutes({ ordering: { prepMinutes: 12.5 } }), null)
  assert.equal(readPrepMinutes({ ordering: { prepMinutes: '20' } }), null)
  assert.equal(readPrepMinutes({ ordering: { prepMinutes: 100000 } }), null)
})

test('the confirmation promises a window and a clock time only while there is something to wait for', () => {
  const placedAt = new Date('2026-10-22T10:00:00Z') // 12:00 in Johannesburg
  const now = new Date('2026-10-22T10:05:00Z')
  assert.deepEqual(orderEta({ status: 'PENDING', placedAt, prepMinutes: 20, now }), { window: 'about 20–30 min', readyBy: '12:20', state: 'expected' })
  assert.deepEqual(orderEta({ status: 'PROCESSING', placedAt, prepMinutes: 20, now }), { window: 'about 20–30 min', readyBy: '12:20', state: 'expected' })
  assert.equal(orderEta({ status: 'CONFIRMED', placedAt, prepMinutes: 20, now: new Date('2026-10-22T10:30:00Z') })?.readyBy, null, 'a passed time is not shown as a promise')
  assert.deepEqual(orderEta({ status: 'READY', placedAt, prepMinutes: 20, now }), { window: 'ready now', readyBy: null, state: 'ready' })
  assert.equal(orderEta({ status: 'PENDING', placedAt, prepMinutes: null, now }), null, 'no setting, no invented number')
  assert.equal(orderEta({ status: 'COMPLETED', placedAt, prepMinutes: 20, now }), null)
  assert.equal(orderEta({ status: 'CANCELLED', placedAt, prepMinutes: 20, now }), null)
})
