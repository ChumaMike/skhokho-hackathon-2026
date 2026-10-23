import test from 'node:test'
import assert from 'node:assert/strict'
import { deviceLabelFrom, parsePushSubscription } from './push-subscriptions.service'

/**
 * The pure edge of Web Push subscriptions: what the browser hands us is
 * checked, not trusted, and the device label never carries the user agent.
 */

// A real Chrome subscription has these shapes: 65-byte point, 16-byte secret.
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const AUTH = 'tBHItJI5svbpez7KI4CCXg'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dpH5lCsTSSM:APA91bHqjZxM0VImWWqDRN7U0a3AycjUf4O-byuxb_wJsKRaKvV_iKw56s16ekq6FUqoCF7k2nICUpd8fHPxVTgqLunFeVeB9lLCQZyohyAztTH8ZQL9WCxKpA6dvTG_TUIhQUFq_n'

test('a browser subscription is accepted only in the exact shape Web Push encryption needs', () => {
  const ok = parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } })
  assert.deepEqual(ok, { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH })

  assert.equal(parsePushSubscription(null), null)
  assert.equal(parsePushSubscription('string'), null)
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT }), null, 'keys are required')
  assert.equal(parsePushSubscription({ endpoint: 'http://push.example/x', keys: { p256dh: P256DH, auth: AUTH } }), null, 'https only')
  assert.equal(parsePushSubscription({ endpoint: 'not a url', keys: { p256dh: P256DH, auth: AUTH } }), null)
  assert.equal(parsePushSubscription({ endpoint: `https://push.example/${'a'.repeat(2100)}`, keys: { p256dh: P256DH, auth: AUTH } }), null, 'too long')
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: 'short', auth: AUTH } }), null, 'wrong key size')
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: 'tBHItJI5svbpez7KI4CCXg!!' } }), null, 'not base64url')
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: '' } }), null)
  // Surrounding whitespace on a key is tidied, not refused.
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: ` ${P256DH} `, auth: AUTH } })?.p256dh, P256DH)
})

test('device labels name a kind of device and never echo the user agent', () => {
  assert.equal(deviceLabelFrom('Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36'), 'Android phone')
  assert.equal(deviceLabelFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'), 'iPhone or iPad')
  assert.equal(deviceLabelFrom('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'), 'Computer')
  assert.equal(deviceLabelFrom(null), 'This device')
  assert.equal(deviceLabelFrom(''), 'This device')
  for (const ua of ['Android', 'iPhone', 'Windows']) assert.ok(!deviceLabelFrom(`${ua} secret-build-12345`).includes('12345'))
})
