import test from 'node:test'
import assert from 'node:assert/strict'
import { applicationServerKey, decidePrompt, promptCopy, promptStorageKey, SIGNIN_TRIGGER_KEY, type PromptEnvironment } from './push-prompt'

/**
 * The offer appears once, only after an order or a sign-in, and never where
 * it can't work. These are the rules PushPrompt.tsx runs in the browser.
 */

const android: PromptEnvironment = { configured: true, supported: true, permission: 'default', ios: false, standalone: false, answered: false, subscribed: false }

test('an Android phone that has not answered yet gets the offer; every reason not to ask hides it', () => {
  assert.equal(decidePrompt(android), 'offer')
  assert.equal(decidePrompt({ ...android, configured: false }), 'hidden', 'no VAPID keys: feature hidden')
  assert.equal(decidePrompt({ ...android, answered: true }), 'hidden', 'asked once already at this shop')
  assert.equal(decidePrompt({ ...android, subscribed: true }), 'hidden', 'already on')
  assert.equal(decidePrompt({ ...android, permission: 'denied' }), 'hidden', 'the browser said no; we do not nag')
  assert.equal(decidePrompt({ ...android, permission: 'granted' }), 'offer', 'permission without a subscription still needs the yes')
  assert.equal(decidePrompt({ ...android, supported: false }), 'hidden')
})

test('an iPhone in Safari is told to add the shop to the Home Screen first; from the Home Screen it gets the normal offer', () => {
  assert.equal(decidePrompt({ ...android, ios: true, supported: false }), 'ios-install-first')
  assert.equal(decidePrompt({ ...android, ios: true, standalone: true }), 'offer')
  assert.equal(decidePrompt({ ...android, ios: true, answered: true }), 'hidden', 'the install hint is also shown once only')
})

test('the copy says what happens, in plain words, and is honest about iPhones', () => {
  const order = promptCopy('order', 'Mzansi Kota', 'offer')
  assert.equal(order.yes, 'Yes, tell me')
  assert.equal(order.no, 'Not now')
  assert.match(order.body, /Mzansi Kota/)
  assert.match(order.body, /switch it off/)
  assert.match(order.body, /No app needed/)
  const signin = promptCopy('signin', 'Mzansi Kota', 'offer')
  assert.notEqual(signin.heading, order.heading)
  const ios = promptCopy('order', 'Mzansi Kota', 'ios-install-first')
  assert.equal(ios.yes, null, 'nothing to switch on until it is installed')
  assert.match(ios.body, /Add to Home Screen/)
  for (const c of [order, signin, ios]) assert.ok(!/notification/i.test(c.heading), 'customers hear "order updates", not jargon')
})

test('storage keys are per shop, and the sign-in flag is one fixed key', () => {
  assert.equal(promptStorageKey('b1'), 'skhokho:push-prompt:b1')
  assert.notEqual(promptStorageKey('b1'), promptStorageKey('b2'))
  assert.equal(typeof SIGNIN_TRIGGER_KEY, 'string')
})

test('the VAPID public key decodes to the 65-byte point PushManager.subscribe wants', () => {
  const bytes = applicationServerKey('BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM')
  assert.equal(bytes.length, 65)
  assert.equal(bytes[0], 0x04, 'uncompressed point marker')
})
