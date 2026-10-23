import test from 'node:test'
import assert from 'node:assert/strict'
import { sendEmail, staffInviteEmail, passwordResetEmail } from './email'

const input = { to: 'staff@example.com', subject: 'Staff invitation', html: '<p>Invitation</p>' }

test('account emails preserve the action link in text and escape merchant content in HTML', () => {
  const url = 'https://skhokho.sgdataint.co.za/staff/set-password?token=test&source=invite'
  const invite = staffInviteEmail({ businessName: '<script>alert(1)</script>', setPasswordUrl: url })
  assert.ok(invite.text.includes(url))
  assert.ok(!invite.html.includes('<script>'))
  assert.ok(invite.html.includes('?token=test&amp;source=invite'))
  const reset = passwordResetEmail({ resetUrl: url })
  assert.ok(reset.text.includes(url))
  assert.ok(reset.text.includes('1 hour'))
})

test('email reports acceptance honestly without sending real email', async (t) => {
  const originalKey = process.env.RESEND_API_KEY
  t.after(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalKey
    t.mock.restoreAll()
  })
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  let response = new Response(JSON.stringify({ id: 'email_accepted' }), { status: 200 })
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => response)

  delete process.env.RESEND_API_KEY
  assert.deepEqual(await sendEmail(input), { sent: false })
  assert.equal(fetchMock.mock.callCount(), 0, 'unconfigured email must not call the provider')

  process.env.RESEND_API_KEY = 're_test_placeholder'
  assert.deepEqual(await sendEmail(input), { sent: true })
  assert.equal(fetchMock.mock.callCount(), 1)

  response = new Response(JSON.stringify({ name: 'validation_error', message: 'Domain not verified' }), { status: 403 })
  assert.deepEqual(await sendEmail(input), { sent: false }, 'a resolved SDK error must trigger the invite-link fallback')

  response = new Response(JSON.stringify({}), { status: 200 })
  assert.deepEqual(await sendEmail(input), { sent: false }, 'missing acceptance ID must not claim success')

  fetchMock.mock.mockImplementation(async () => { throw new Error('Network unavailable') })
  assert.deepEqual(await sendEmail(input), { sent: false })
})
