import test from 'node:test'
import assert from 'node:assert/strict'
import { customerOrderPlacedText, customerOrderStatusText } from './templates'

/** Phone texts: short, carry the order number, and never a code or a shop-side tracking token. */

test('status texts name the order and the shop, fit a phone, and carry no secret', () => {
  for (const status of ['CONFIRMED', 'READY_FOR_COLLECTION', 'DRIVER_ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const) {
    const text = customerOrderStatusText({ status, businessName: 'Kota Kings', orderNumber: 'ORD-AB12-CD34', contact: '+27 82 123 4567' })
    assert.ok(text.startsWith('Order ORD-AB12-CD34:'), text)
    assert.ok(text.includes('Kota Kings'))
    assert.ok(text.includes('+27 82 123 4567'))
    assert.ok(text.length <= 220, `${status}: ${text.length} chars`)
    assert.ok(!/https?:\/\//.test(text) && !/\b\d{6}\b/.test(text), 'no links, no six-digit codes')
  }
  const noContact = customerOrderStatusText({ status: 'READY_FOR_COLLECTION', businessName: 'Kota Kings', orderNumber: 'ORD-1', contact: null })
  assert.ok(!noContact.includes('Questions?'))
})

test('the confirmation text says how, how much, how to pay, and links the customer to their own page', () => {
  const collection = customerOrderPlacedText({
    businessName: 'Kota Kings',
    orderNumber: 'ORD-AB12-CD34',
    totalFormatted: 'R 1 234.56',
    fulfilmentMethod: 'COLLECTION',
    paymentMessage: 'Pay when you collect.',
    trackingUrl: 'https://kota.skhokholabs.app/store/order/abc',
    deliveryUrl: null,
  })
  assert.equal(collection, 'Thanks! Order ORD-AB12-CD34 at Kota Kings for collection, R 1 234.56. Pay when you collect. Your order: https://kota.skhokholabs.app/store/order/abc')

  const delivery = customerOrderPlacedText({
    businessName: 'Kota Kings',
    orderNumber: 'ORD-1',
    totalFormatted: 'R 80.00',
    fulfilmentMethod: 'DELIVERY',
    paymentMessage: '',
    trackingUrl: 'https://kota.skhokholabs.app/store/order/abc',
    deliveryUrl: 'https://skhokho.sgdataint.co.za/delivery/k3y',
  })
  assert.ok(delivery.includes('for delivery, R 80.00.') && delivery.includes('/delivery/k3y'))
  assert.ok(!delivery.includes('Pay '), 'paid online: no pay line')
})
