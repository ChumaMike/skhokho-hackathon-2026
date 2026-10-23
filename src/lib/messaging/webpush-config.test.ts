import test from 'node:test'
import assert from 'node:assert/strict'
import { isWebPushConfigured, readWebPushConfig, webPushPublicKey } from './webpush-config'

/**
 * Web Push is on only when all three VAPID variables are present and look
 * like keys; anything less hides the feature, and a page can only ever get
 * the public key.
 */

const PUBLIC = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const PRIVATE = 'tUxYj4zJqM1dK7eVbT1Rn2XGwqv3sLJfQm8bC6hZ0aE'
const good = { WEBPUSH_VAPID_PUBLIC_KEY: PUBLIC, WEBPUSH_VAPID_PRIVATE_KEY: PRIVATE, WEBPUSH_SUBJECT: 'mailto:help@skhokho.test' }

test('all three variables, well formed, switch Web Push on', () => {
  assert.deepEqual(readWebPushConfig(good), { publicKey: PUBLIC, privateKey: PRIVATE, subject: 'mailto:help@skhokho.test' })
  assert.equal(isWebPushConfigured(good), true)
  assert.equal(webPushPublicKey(good), PUBLIC)
  assert.equal(readWebPushConfig({ ...good, WEBPUSH_SUBJECT: 'https://skhokho.test/contact' })?.subject, 'https://skhokho.test/contact')
  assert.equal(readWebPushConfig({ ...good, WEBPUSH_VAPID_PUBLIC_KEY: ` ${PUBLIC} ` })?.publicKey, PUBLIC, 'whitespace is tidied')
})

test('anything missing or malformed hides the feature rather than half-configuring it', () => {
  assert.equal(readWebPushConfig({}), null)
  assert.equal(isWebPushConfigured({}), false)
  assert.equal(webPushPublicKey({}), null)
  for (const missing of Object.keys(good)) {
    assert.equal(readWebPushConfig({ ...good, [missing]: '' }), null, `${missing} empty`)
    assert.equal(readWebPushConfig({ ...good, [missing]: undefined }), null, `${missing} unset`)
  }
  assert.equal(readWebPushConfig({ ...good, WEBPUSH_VAPID_PUBLIC_KEY: 'short' }), null)
  assert.equal(readWebPushConfig({ ...good, WEBPUSH_VAPID_PUBLIC_KEY: PUBLIC.replace('B', '+') }), null, 'base64 (not url) alphabet')
  assert.equal(readWebPushConfig({ ...good, WEBPUSH_VAPID_PRIVATE_KEY: PUBLIC }), null, 'a public key where the private one goes')
  assert.equal(readWebPushConfig({ ...good, WEBPUSH_SUBJECT: 'help@skhokho.test' }), null, 'subject needs mailto: or https://')
  assert.equal(readWebPushConfig({ ...good, WEBPUSH_SUBJECT: 'http://skhokho.test' }), null)
})
