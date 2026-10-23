import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { customerOrderPlacedText, customerOrderStatusText } from './templates'
import { loginCodeText } from '@/modules/customers/customer-auth.service'
import {
  WHATSAPP_TEMPLATES,
  STATUS_TEMPLATE,
  STOP_FOOTER,
  STOP_REPLY_TEXT,
  START_REPLY_TEXT,
  NO_CONTACT_FALLBACK,
  BUTTON_URL_BASE_PLACEHOLDER,
  cleanVariable,
  parseOrderStatusText,
  parseOrderPlacedText,
  templateFromText,
  renderTemplateBody,
  templateByName,
} from './whatsapp-templates'

/**
 * The catalogue is what gets submitted to Meta, and the parser is what turns
 * the seam's plain text back into it. Both are locked here: Meta's limits on
 * the specs, and a round trip from the real text functions for every
 * milestone — so a wording change in templates.ts that the catalogue cannot
 * place fails this suite instead of a production send.
 */

const STATUSES = ['CONFIRMED', 'READY_FOR_COLLECTION', 'DRIVER_ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const

test("every spec fits Meta's limits and its variables are numbered, sampled and described", () => {
  for (const spec of Object.values(WHATSAPP_TEMPLATES)) {
    assert.match(spec.name, /^[a-z0-9_]{1,512}$/, `${spec.key}: template names are lowercase letters, digits and underscores`)
    assert.ok(spec.body.length <= 1024, `${spec.key}: body is 1024 characters max`)
    assert.ok(!/[\r\n\t]/.test(spec.body), `${spec.key}: one paragraph`)
    const numbers = [...spec.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))
    assert.deepEqual(numbers, numbers.map((_, i) => i + 1), `${spec.key}: variables are {{1}}..{{n}} in order, none repeated`)
    assert.equal(spec.variables.length, numbers.length, `${spec.key}: one description per variable`)
    assert.equal(spec.samples.length, numbers.length, `${spec.key}: one sample per variable`)
    assert.ok(!/^\{\{\d+\}\}/.test(spec.body) || spec.category === 'AUTHENTICATION', `${spec.key}: a utility body does not start with a variable`)
    assert.ok(!/\{\{\d+\}\}$/.test(spec.body), `${spec.key}: a body does not end with a variable`)
    if (spec.footer) assert.ok(spec.footer.length <= 60 && !/\{\{/.test(spec.footer), `${spec.key}: footer is 60 characters max, no variables`)
    for (const b of spec.buttons ?? []) {
      assert.ok(b.label.length <= 25, `${spec.key}: button labels are 25 characters max`)
      if (b.type === 'url') assert.ok(b.urlBase?.startsWith(BUTTON_URL_BASE_PLACEHOLDER) && b.urlBase.endsWith('{{1}}'), `${spec.key}: a dynamic URL is the app origin plus a {{1}} suffix`)
    }
    assert.ok((spec.buttons ?? []).filter((b) => b.type === 'url').length <= 2, `${spec.key}: at most two URL buttons`)
    if (spec.category === 'UTILITY') assert.equal(spec.footer, STOP_FOOTER, `${spec.key}: every utility template tells the customer how to stop`)
  }
  const names = Object.values(WHATSAPP_TEMPLATES).map((t) => t.name)
  assert.equal(new Set(names).size, names.length, 'template names are unique')
  assert.equal(templateByName('skhokho_order_confirmed')?.key, 'order_confirmed')
  assert.equal(templateByName('nope'), null)
})

test('every order status has a template, and the real status text round-trips into it', () => {
  for (const status of STATUSES) {
    assert.ok(STATUS_TEMPLATE[status], status)
    for (const contact of ['+27 82 999 0000', null]) {
      for (const businessName of ['Kota Kings', 'Kota on Main (Soweto)', 'A. & B. — Bakery']) {
        const text = customerOrderStatusText({ status, businessName, orderNumber: 'ORD-AB12-CD34', contact })
        const facts = parseOrderStatusText(text)
        assert.deepEqual(facts, { status, orderNumber: 'ORD-AB12-CD34', businessName, contact }, text)
        const t = templateFromText('customer_order_status', text)
        assert.ok(t, text)
        assert.equal(t.name, WHATSAPP_TEMPLATES[STATUS_TEMPLATE[status]].name)
        assert.equal(t.category, 'utility')
        assert.deepEqual(t.variables, ['ORD-AB12-CD34', businessName, contact ?? NO_CONTACT_FALLBACK])
        assert.deepEqual(t.buttons, [])
        const body = renderTemplateBody(t.key, t.variables)
        assert.ok(body.includes('ORD-AB12-CD34') && body.includes(businessName) && !/\{\{/.test(body), body)
      }
    }
  }
  assert.equal(parseOrderStatusText('Order X: something else entirely.'), null)
  assert.equal(templateFromText('customer_order_status', 'Hello there'), null, 'unknown wording is refused, not guessed')
})

test('the confirmation text round-trips: collection → order-page button, delivery → delivery-page button, pay line → payment variable', () => {
  const collection = customerOrderPlacedText({
    businessName: 'Kota Kings',
    orderNumber: 'ORD-1',
    totalFormatted: 'R 1 234.56',
    fulfilmentMethod: 'COLLECTION',
    paymentMessage: 'Pay when you collect.',
    trackingUrl: 'https://skhokho.sgdataint.co.za/store/order/clx123abc',
    deliveryUrl: null,
  })
  assert.deepEqual(parseOrderPlacedText(collection), {
    orderNumber: 'ORD-1',
    businessName: 'Kota Kings',
    how: 'for collection',
    totalFormatted: 'R 1 234.56',
    paymentMessage: 'Pay when you collect.',
    url: 'https://skhokho.sgdataint.co.za/store/order/clx123abc',
  })
  const c = templateFromText('customer_order_confirmation', collection)
  assert.ok(c)
  assert.equal(c.name, 'skhokho_order_placed')
  assert.deepEqual(c.variables, ['ORD-1', 'Kota Kings', 'for collection', 'R 1 234.56', 'pay when you collect'])
  assert.deepEqual(c.buttons, ['clx123abc'])

  const delivery = customerOrderPlacedText({
    businessName: 'Kota on Main',
    orderNumber: 'ORD-2',
    totalFormatted: 'R 80.00',
    fulfilmentMethod: 'DELIVERY',
    paymentMessage: '',
    trackingUrl: 'https://skhokho.sgdataint.co.za/store/order/clx999',
    deliveryUrl: 'https://skhokho.sgdataint.co.za/delivery/k3y-abc',
  })
  const d = templateFromText('customer_order_confirmation', delivery)
  assert.ok(d)
  assert.equal(d.name, 'skhokho_order_placed_delivery')
  assert.deepEqual(d.variables, ['ORD-2', 'Kota on Main', 'for delivery', 'R 80.00', 'paid online'])
  assert.deepEqual(d.buttons, ['k3y-abc'], 'only the key — the last segment of the customer\'s own link')
  assert.ok(!d.buttons.some((b) => /^https?:/.test(b)) && !d.variables.some((v) => /^https?:/.test(v)), 'no full URL travels as a variable')

  const driver = customerOrderPlacedText({
    businessName: 'Kota Kings',
    orderNumber: 'ORD-3',
    totalFormatted: 'R 95.00',
    fulfilmentMethod: 'DELIVERY',
    paymentMessage: 'Pay the driver when it arrives.',
    trackingUrl: 'https://skhokho.sgdataint.co.za/store/order/clx1',
    deliveryUrl: 'https://skhokho.sgdataint.co.za/delivery/k2',
  })
  assert.deepEqual(templateFromText('customer_order_confirmation', driver)?.variables.at(-1), 'pay the driver when it arrives')
  assert.equal(templateFromText('customer_order_confirmation', 'Thanks for nothing'), null)
})

test('the sign-in code becomes the authentication template with the code on the copy button; anything else has no template', () => {
  const t = templateFromText('customer_login_code', loginCodeText('482913', 'Kota Kings'))
  assert.ok(t)
  assert.equal(t.name, 'skhokho_login_code')
  assert.equal(t.category, 'authentication')
  assert.deepEqual(t.variables, ['482913'])
  assert.deepEqual(t.buttons, ['482913'])
  assert.equal(templateFromText('customer_login_code', 'no code here'), null)
  assert.equal(templateFromText('unspecified', 'free text'), null, 'unspecified is the reply path, not a template')
})

test('variables are cleaned the way Meta requires: no newlines or tabs, no runs of spaces, never empty', () => {
  assert.equal(cleanVariable('Kota\nKings\t  Soweto'), 'Kota Kings Soweto')
  assert.equal(cleanVariable('   '), '-')
})

test('docs/notifications-whatsapp.md carries every template exactly, plus the STOP and START replies', () => {
  const doc = readFileSync(join(process.cwd(), 'docs', 'notifications-whatsapp.md'), 'utf8')
  for (const spec of Object.values(WHATSAPP_TEMPLATES)) {
    assert.ok(doc.includes(`\`${spec.name}\` — ${spec.category}, ${spec.language}`), `${spec.name}: heading with category and language`)
    assert.ok(doc.includes(`\n${spec.body}\n`), `${spec.name}: body quoted exactly`)
    if (spec.footer) assert.ok(doc.includes(spec.footer), `${spec.name}: footer`)
    for (const b of spec.buttons ?? []) {
      assert.ok(doc.includes(b.label), `${spec.name}: button label ${b.label}`)
      if (b.urlBase) assert.ok(doc.includes(b.urlBase), `${spec.name}: button URL ${b.urlBase}`)
    }
  }
  assert.ok(doc.includes(STOP_REPLY_TEXT) && doc.includes(START_REPLY_TEXT))
})
