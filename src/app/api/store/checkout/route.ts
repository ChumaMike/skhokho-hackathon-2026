import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { formatZAR, getAppUrl } from '@/lib/utils'
import { sendEmail, isEmailConfigured, newOrderEmail, customerOrderConfirmationEmail } from '@/lib/email'
import { registerCustomer } from '@/modules/customers/customer.service'
import { recordChannelConsent } from '@/modules/customers/channel-consent'
import { createOrder } from '@/modules/orders/order.service'
import { resolveCheckoutPayment } from '@/modules/orders/checkout-payment'
import { getReceivingConnection } from '@/modules/payments/payment-connection.service'
import { resolveStorefrontCartQuote, CartLineSchema, MAX_CART_LINES } from '@/modules/orders/storefront-cart'
import { apiRequestTenant } from '@/lib/tenant/storefront-request'
import { countServerEvent } from '@/modules/storefront-learning/events'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { issueCustomerDeliveryKey } from '@/modules/skhokholetha/customer-key'
import { isCurrentTermsVersion, TERMS_OUTDATED_MESSAGE } from '@/lib/legal/documents'
import { toE164Mobile } from '@/lib/messaging/provider'
import { notifyCustomerOrderPlacedByPhone } from '@/modules/orders/customer-notifications'

export const runtime = 'nodejs'

const CheckoutRequestSchema = z.object({
  businessId: z.string().uuid(),
  lines: z.array(CartLineSchema).min(1).max(MAX_CART_LINES),
  fulfilmentMethod: z.enum(['COLLECTION', 'DELIVERY']).default('COLLECTION'),
  deliveryAddress: z.string().trim().max(500).optional(),
  deliveryInstructions: z.string().trim().max(500).optional(),
  /** ZONE pricing: the area the customer chose. Validated against the business's own active zones server-side. */
  deliveryZoneId: z.string().trim().min(1).max(64).optional(),
  /** A note for the shop (e.g. "no onions", "ring the bell") — any fulfilment method. */
  notes: z.string().trim().max(500).optional(),
  phone: z.string().min(1),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(254).optional(),
  consent: z.boolean(),
  termsVersion: z.string().max(40).optional(), // Terms version shown at checkout; must be current (src/lib/legal/documents.ts)
  consentMarketing: z.boolean().default(false),
  /** "Pay now by card" or "pay in person" — honoured only when the shop offers both (checkout-payment.ts decides). */
  paymentChoice: z.enum(['CARD', 'IN_PERSON']).optional(),
  // Client-generated (a random token, never PII) — see order.service.ts's
  // checkoutIdempotencyKey. Required: every real checkout attempt from the
  // basket UI generates one before submitting.
  idempotencyKey: z.string().min(8).max(100),
  // Purely informational — the last total the checkout UI showed the
  // customer. NEVER trusted as authorization; only used to detect "the
  // cart quietly moved since you last looked at it" and force a re-review.
  // An adversarial client lying about this changes nothing: the order is
  // always created from the FRESH server quote below, never from this.
  expectedTotal: z.string().optional(),
})

type ErrorCode =
  | 'INVALID_REQUEST'
  | 'BUSINESS_UNAVAILABLE'
  | 'ORDERS_UNAVAILABLE'
  | 'HOURS_CLOSED'
  | 'ORDERS_PAUSED'
  | 'COLLECTION_UNAVAILABLE'
  | 'OUTSIDE_SERVICE_AREA'
  | 'DELIVERY_AREA_REQUIRED'
  | 'CART_EMPTY'
  | 'BELOW_MINIMUM_ORDER'
  | 'DELIVERY_UNAVAILABLE'
  | 'DELIVERY_PRICING_UNAVAILABLE'
  | 'DELIVERY_DISTANCE_UNAVAILABLE'
  | 'DELIVERY_ADDRESS_REQUIRED'
  | 'CART_CHANGED'
  | 'INVALID_PHONE'
  | 'INVALID_EMAIL'
  | 'CONSENT_REQUIRED'
  | 'TERMS_OUTDATED'
  | 'ORDER_FAILED'

function fail(code: ErrorCode, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, code, message, ...extra })
}

/**
 * Single streamlined storefront basket checkout — replaces the old
 * per-product form POST (api/store/order/route.ts, now removed). A
 * request here is structurally just identifiers/quantities plus the
 * customer's own contact/consent input; every authoritative number
 * (name, unitPrice, deliveryFee, total) is resolved server-side via
 * resolveStorefrontCartQuote, exactly twice — once to price the request,
 * once more (implicitly, by re-deriving the same values passed into
 * createOrder) at creation — never trusted from the client. One request
 * creates ONE Order with N OrderItems, never one Order per line.
 */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimits([['checkoutIp', clientIp(req)]])
  if (!limited.allowed) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('INVALID_REQUEST', 'Malformed request.')
  }

  const parsed = CheckoutRequestSchema.safeParse(body)
  if (!parsed.success) return fail('INVALID_REQUEST', 'Malformed checkout request.')
  const input = parsed.data

  if (!input.consent) return fail('CONSENT_REQUIRED', 'Please accept the terms to continue.')
  if (!isCurrentTermsVersion(input.termsVersion)) return fail('TERMS_OUTDATED', TERMS_OUTDATED_MESSAGE)

  // A tenant hostname may only act on its own business (storefront-request.ts).
  const hostTenant = await apiRequestTenant(req)
  if (hostTenant && hostTenant.id !== input.businessId) {
    return fail('BUSINESS_UNAVAILABLE', 'This shop is not available right now.')
  }

  const quoteResult = await resolveStorefrontCartQuote({
    businessId: input.businessId,
    lines: input.lines,
    fulfilmentMethod: input.fulfilmentMethod,
    deliveryAddress: input.deliveryAddress,
    deliveryZoneId: input.deliveryZoneId,
  })

  if (!quoteResult.ok) {
    const messages: Record<typeof quoteResult.code, string> = {
      BUSINESS_UNAVAILABLE: 'This business is not currently available.',
      ORDERS_UNAVAILABLE: 'This business is not accepting orders right now.',
      HOURS_CLOSED: 'This business is closed right now. Check their opening hours and try again later.',
      ORDERS_PAUSED: 'This business has paused new orders for a little while. Please try again soon.',
      COLLECTION_UNAVAILABLE: "This business doesn't offer collection — choose delivery.",
      OUTSIDE_SERVICE_AREA: "Sorry, this business doesn't deliver to that area.",
      CART_EMPTY: 'Your basket is empty or no longer available.',
      BELOW_MINIMUM_ORDER: "Your basket is below this business's minimum order amount.",
      DELIVERY_UNAVAILABLE: 'Delivery is not available for this business.',
      DELIVERY_PRICING_UNAVAILABLE: "Delivery pricing isn't available right now — please contact the business.",
      DELIVERY_DISTANCE_UNAVAILABLE:
        "We couldn't calculate delivery for that address. Please check it and try again, or contact the business directly.",
    }
    return fail(quoteResult.code, messages[quoteResult.code])
  }
  const { quote } = quoteResult

  // The cart moved since the customer last reviewed it (a price changed, an
  // item disappeared, a quantity was capped) — never silently charge an
  // amount/selection they never actually saw. Also catches a stale
  // expectedTotal even when nothing in `quote.changed` fired (e.g. the
  // client's own local total drifted for some other reason) — either way,
  // the fix is the same: show the fresh quote, require review again.
  const totalDrifted = input.expectedTotal !== undefined && input.expectedTotal !== quote.total
  if (quote.changed || totalDrifted) {
    return fail('CART_CHANGED', 'Your basket changed — please review it again before placing your order.', { quote })
  }

  if (input.fulfilmentMethod === 'DELIVERY' && !input.deliveryAddress) {
    return fail('DELIVERY_ADDRESS_REQUIRED', 'Enter a delivery address.')
  }
  // A delivery order must carry ONE exact fee — a pending quote (area not
  // chosen yet) can be displayed, never charged.
  if (quote.fulfilmentMethod === 'DELIVERY' && quote.deliveryFeePending) {
    return fail('DELIVERY_AREA_REQUIRED', 'Choose your delivery area so we can give you an exact delivery fee.')
  }

  let membershipId: string
  try {
    // B6: a public checkout can't prove phone ownership — no email is attached
    // to the customer's identity and no marketing consent is recorded here.
    const reg = await registerCustomer(input.businessId, input.phone, input.name || undefined, 'storefront_order')
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM memberships WHERE public_id = ${reg.public_id}::uuid LIMIT 1`
    if (!rows[0]?.id) return fail('ORDER_FAILED', 'Could not place the order. Try again.')
    membershipId = rows[0].id
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    if (message.includes('mobile number')) return fail('INVALID_PHONE', message)
    if (message.includes('email address')) return fail('INVALID_EMAIL', message)
    return fail('ORDER_FAILED', 'Could not place the order. Check your details and try again.')
  }

  // Decided before the order is created so paymentMethod is written with it,
  // rather than patched afterwards. Either the platform has no working
  // gateway or this business has turned card payment off — both mean the
  // order is still placed and settled in person.
  const businessForPayment = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { slug: true, settings: true },
  })
  if (!businessForPayment) return fail('ORDER_FAILED', 'Could not place the order. Try again.')
  // Resolved from the order's own business, never from anything the customer
  // submitted. No verified connection means no card option — there is
  // deliberately no platform account to fall back to.
  const receiving = await getReceivingConnection(input.businessId)
  const payment = resolveCheckoutPayment(businessForPayment, quote.fulfilmentMethod, receiving, input.paymentChoice)

  try {
    const order = await createOrder(input.businessId, {
      membershipId,
      source: 'online',
      items: quote.lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        // The price actually charged per unit — base price PLUS every
        // selected option's delta (Food Menu Domain Foundation §12). Never
        // `line.unitPrice` alone, which is only the product's base price.
        unitPrice: Number(line.configuredUnitPrice),
        discount: 0,
        options: line.options.map((o) => ({
          groupId: o.groupId,
          optionId: o.optionId,
          groupName: o.groupName,
          optionName: o.optionName,
          priceDelta: Number(o.priceDelta),
        })),
      })),
      discount: 0,
      paymentStatus: 'PENDING',
      // CASH when it will be settled at handover; left unset for an online
      // payment, where the gateway's ITN callback is what records how it was
      // actually paid.
      ...(payment.kind === 'in_person' ? { paymentMethod: payment.method } : {}),
      fulfilmentMethod: quote.fulfilmentMethod,
      deliveryFee: Number(quote.deliveryFee),
      deliveryFeeCents: quote.fulfilmentMethod === 'DELIVERY' ? Math.round(Number(quote.deliveryFee) * 100) : undefined,
      deliveryZoneId: quote.deliveryZone?.id,
      deliveryZoneName: quote.deliveryZone?.name,
      notes: input.notes || undefined,
      notifyEmail: confirmationEmail(input.email) ?? undefined,
      deliveryAddress: quote.fulfilmentMethod === 'DELIVERY' ? input.deliveryAddress : undefined,
      deliveryInstructions: quote.fulfilmentMethod === 'DELIVERY' ? input.deliveryInstructions || undefined : undefined,
      deliveryContactPhone: quote.fulfilmentMethod === 'DELIVERY' ? input.phone : undefined,
      deliveryLat: quote.fulfilmentMethod === 'DELIVERY' ? quote.deliveryCoords?.lat : undefined,
      deliveryLng: quote.fulfilmentMethod === 'DELIVERY' ? quote.deliveryCoords?.lng : undefined,
      checkoutIdempotencyKey: input.idempotencyKey,
      termsVersion: input.termsVersion,
    })
    if (!order) return fail('ORDER_FAILED', 'Could not place the order. Try again.')

    // Where THIS order's status messages go by phone — the number typed at
    // checkout, kept on the order like notifyEmail (never on the identity).
    // Written once, for a genuinely new order; a retried checkout keeps it.
    const notifyPhone = toE164Mobile(input.phone)
    if (order.created && notifyPhone) {
      const existing = (order.metadata ?? {}) as Record<string, unknown>
      await prisma.order.update({ where: { id: order.id }, data: { metadata: { ...existing, notifyPhone } } })
    }
    // The number typed for THIS order's updates, with the Terms accepted, is
    // the customer's order-updates consent at this shop (docs/legal/consent-wording.md,
    // Consent 3 — order updates). Written to the consents ledger through its
    // RPC, so a later STOP has a grant to withdraw and the evidence is kept.
    if (order.created && notifyPhone) {
      after(() =>
        recordChannelConsent({
          phone: notifyPhone,
          channel: 'whatsapp',
          purpose: 'order_updates',
          granted: true,
          source: 'storefront_checkout',
          evidence: { order_number: order.orderNumber, terms_version: input.termsVersion ?? null },
          businessId: input.businessId,
        }),
      )
    }

    // The customer's own delivery key (Skhokholetha proof of delivery): handed
    // to THIS browser and the customer's own email only — never stored in a
    // form the business can read. Same key on a retried checkout.
    let deliveryUrl: string | null = null
    if (quote.fulfilmentMethod === 'DELIVERY') {
      const od = await prisma.orderDelivery.findUnique({ where: { orderId: order.id }, select: { id: true } })
      if (od) deliveryUrl = `${getAppUrl(new URL(req.url).origin)}/delivery/${await issueCustomerDeliveryKey(od.id)}`
    }
    // The confirmation page: order number, status, what to pay, the tracking
    // section. Shown right after checkout and linked from the text/email.
    const confirmationPath = `/store/order/${order.id}`
    const trackingUrl = `${getAppUrl(new URL(req.url).origin)}${confirmationPath}`

    // Fire notifications only for a genuinely new order — a duplicate
    // submission (double-tap, refresh, retry) with the same idempotency
    // key gets back the SAME order via createOrder's own idempotency
    // short-circuit, `created: false`. One checkout must trigger at most
    // one owner email and one customer email, never once per retry.
    if (order.created) {
      // Resolved option NAMES only (§17 — never raw ids/JSON in a
      // customer-facing confirmation).
      const emailItems = quote.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        options: l.options.map((o) => o.optionName),
      }))
      // Storefront learning: a counter only — no customer or order details.
      after(() => countServerEvent(input.businessId, 'ORDER_PLACED', 'CHECKOUT'))
      after(() =>
        notifyOwnerOfOrder(input.businessId, order.orderNumber, Number(order.total), emailItems, quote.fulfilmentMethod),
      )
      after(() =>
        notifyCustomerOfOrder(
          input.businessId,
          // Confirmation goes only to the address typed for THIS order.
          confirmationEmail(input.email),
          order.orderNumber,
          Number(order.total),
          emailItems,
          quote.fulfilmentMethod,
          deliveryUrl,
        ),
      )
      // The same confirmation as a text, so a phone-only customer is never
      // without their order number and their own page.
      after(() =>
        notifyCustomerOrderPlacedByPhone(order.id, {
          trackingUrl,
          deliveryUrl,
          paymentMessage: payment.kind === 'in_person' ? payment.customerMessage.replace(/^Order placed — /, '').replace(/^p/, 'P') : '',
        }),
      )
    }

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total.toString(),
      // Only this customer receives it; the storefront keeps it in this browser.
      deliveryUrl,
      // An in-person order has nothing to hand off to a gateway, so it goes
      // straight back to the shop with the news, instead of through a payment
      // page that would have to explain itself. The `ok` value is a fixed key
      // the storefront page maps to canned copy — never the raw message text —
      // so this redirect target can't be used to puppet arbitrary banner text
      // on the public storefront.
      trackingUrl,
      // An in-person order goes straight to its confirmation page (order
      // number, what to pay, tracking) — a phone-only customer is never left
      // without them. `placed=1` only switches on the "thanks" banner there;
      // the page renders every fact from the order itself, never from the URL.
      redirectTo: payment.kind === 'online' ? `/store/pay/${order.id}` : `${confirmationPath}?placed=1`,
    })
  } catch (e) {
    console.error('[store/checkout] order creation failed:', e)
    return fail('ORDER_FAILED', (e as Error).message || 'Could not place the order. Try again.')
  }
}

/** Fire-and-forget, never blocks the response — a failed email must never roll back or fail an already-created Order. */
async function notifyOwnerOfOrder(
  businessId: string,
  orderNumber: string,
  total: number,
  items: { name: string; quantity: number; options: string[] }[],
  fulfilmentMethod: 'COLLECTION' | 'DELIVERY',
) {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, owner: { select: { email: true } } },
    })
    if (!business?.owner?.email) return

    const { subject, html } = newOrderEmail({
      businessName: business.name,
      orderNumber,
      totalFormatted: formatZAR(total),
      items,
      fulfilmentMethod,
    })
    const { sent } = await sendEmail({ to: business.owner.email, subject, html, kind: 'owner_new_order' })

    // Configured but genuinely failed (Resend rejected it, network error) —
    // distinct from "not configured at all", which the dashboard already
    // discloses live via isEmailConfigured(). A row here is the one real
    // silent-failure mode worth a persistent trace instead of only a
    // console.error, without adding noise to every order a business with
    // no email setup yet places.
    if (!sent && isEmailConfigured()) {
      await prisma.businessNotification.create({
        data: {
          businessId,
          type: 'order_email_failed',
          title: 'Order email not sent',
          message: `We couldn't email you about order ${orderNumber} — check it in your dashboard.`,
          data: { orderNumber },
        },
      })
    }
  } catch (e) {
    console.error('[store/checkout] owner notification failed:', e)
  }
}

/** Only sends if the customer supplied an email at checkout. */
/** A plausible email typed at this checkout, or null. Never read from a stored identity. */
function confirmationEmail(raw: string | undefined): string | null {
  const email = (raw ?? '').trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

async function notifyCustomerOfOrder(
  businessId: string,
  email: string | null,
  orderNumber: string,
  total: number,
  items: { name: string; quantity: number; options: string[] }[],
  fulfilmentMethod: 'COLLECTION' | 'DELIVERY',
  deliveryUrl: string | null,
) {
  try {
    if (!email) return

    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } })
    if (!business) return

    const { subject, html } = customerOrderConfirmationEmail({
      businessName: business.name,
      orderNumber,
      totalFormatted: formatZAR(total),
      items,
      fulfilmentMethod,
      deliveryUrl,
    })
    await sendEmail({ to: email, subject, html, kind: 'customer_order_confirmation' })
  } catch (e) {
    console.error('[store/checkout] customer confirmation failed:', e)
  }
}
