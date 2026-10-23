/**
 * Transactional email — order confirmations, booking confirmations,
 * password resets. There was zero email infrastructure before this; this
 * is deliberately minimal (one send function, plain-HTML templates using
 * the same brand tokens as the rest of the app), not a template engine.
 *
 * Gracefully degrades when unconfigured: without RESEND_API_KEY, sendEmail
 * logs the email instead of sending it and returns normally. This keeps
 * every email-triggering flow (checkout, booking, password reset)
 * exercisable and testable without a real API key, matching how the rest
 * of this app already treats "not configured yet" — e.g. the deliberately
 * fake env values noted in this workspace's tool-graduation record.
 */

import { Resend } from 'resend'

let cachedClient: Resend | null = null

/** Whether transactional email is configured for this deployment. */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  if (!cachedClient) cachedClient = new Resend(apiKey)
  return cachedClient
}

const FROM = process.env.EMAIL_FROM ?? 'Skhokho <no-reply@skhokho.app>'

/** What kind of email this is — the only label that reaches logs and the audit trail (never the address or subject). */
export type EmailKind =
  | 'driver_verify'
  | 'business_email_verify'
  | 'customer_order_confirmation'
  | 'customer_order_status'
  | 'owner_new_order'
  | 'owner_payment_issue'
  | 'customer_booking_confirmation'
  | 'owner_new_booking'
  // A storefront quote / enquiry / pickup / callback request (Tab 7).
  | 'owner_new_lead'
  | 'password_reset'
  | 'staff_invite'
  /** Skhokho Laboratory billing the merchant — never a merchant's own customer. */
  | 'platform_billing'
  | 'unspecified'
  // Tab 3 (customer accounts) — appended, never reordered.
  | 'customer_login_code'
  | 'owner_order_cancelled_by_customer'

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text?: string
  kind?: EmailKind
}

type Transport = (msg: { from: string; to: string; subject: string; html: string; text?: string }) => Promise<{ id?: string | null; errorName?: string | null }>

let testTransport: Transport | null = null
/** Tests only: replace the provider (null restores Resend). */
export function __setEmailTransportForTests(t: Transport | null) {
  testTransport = t
}

let lastUnconfiguredEventAt = 0

async function observe(action: 'email_failed' | 'email_unconfigured', kind: EmailKind, detail?: string) {
  // Lazy import keeps email.ts light for its many importers; never throws.
  const [{ log }, { systemEvent }] = await Promise.all([import('./log'), import('@/modules/platform-admin/audit')])
  log(action === 'email_failed' ? 'error' : 'warn', `email.${action === 'email_failed' ? 'failed' : 'unconfigured'}`, { kind, detail })
  if (action === 'email_unconfigured') {
    // One audit event per 10 minutes per instance is enough to see "email is off".
    if (Date.now() - lastUnconfiguredEventAt < 10 * 60 * 1000) return
    lastUnconfiguredEventAt = Date.now()
  }
  await systemEvent(action, { outcome: 'FAILURE', metadata: { kind, detail } })
}

/**
 * Sends via Resend if configured. Never throws: the order, booking, token or
 * delivery that triggered the email already exists in Postgres (the source of
 * truth), so a failed send must not undo or block it. Failures are OBSERVABLE:
 * a structured log line plus a SYSTEM audit event (kind + provider error name
 * only — never the recipient, subject, links or tokens in the body).
 */
export async function sendEmail(input: SendEmailInput): Promise<{ sent: boolean }> {
  const kind = input.kind ?? 'unspecified'
  const client = testTransport ? null : getClient()
  if (!client && !testTransport) {
    await observe('email_unconfigured', kind).catch(() => undefined)
    return { sent: false }
  }

  try {
    const msg = { from: FROM, to: input.to, subject: input.subject, html: input.html, text: input.text }
    let id: string | null | undefined
    let errorName: string | null | undefined
    if (testTransport) ({ id, errorName } = await testTransport(msg))
    else {
      // Resend resolves API failures with an error object instead of throwing.
      const { data, error } = await client!.emails.send(msg)
      id = data?.id
      errorName = error?.name
    }
    // Only provider acceptance counts as sent; inbox delivery is separate.
    if (errorName || !id) {
      await observe('email_failed', kind, errorName ?? 'missing_message_id').catch(() => undefined)
      return { sent: false }
    }
    return { sent: true }
  } catch (e) {
    await observe('email_failed', kind, e instanceof Error ? e.name : 'unknown').catch(() => undefined)
    return { sent: false }
  }
}

// ---------------------------------------------------------------------------
// Templates — plain HTML, brand tokens hardcoded (email clients don't run
// the app's CSS custom properties), DESIGN.md's "plain, warm South African
// English" voice.
// ---------------------------------------------------------------------------

function wrapper(bodyHtml: string): string {
  return `
    <div style="background:#0E0A05;padding:32px 16px;font-family:Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background:#171009;border:1px solid #2E2011;border-radius:14px;padding:28px;">
        <p style="color:#E8A020;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 0 16px;">Skhokho</p>
        ${bodyHtml}
      </div>
    </div>`
}

/**
 * Notifies the BUSINESS OWNER, not the customer — the storefront identity
 * model is phone-only by design (no customer email is ever collected, see
 * customer.service.ts), so there is no address to confirm an order *to* on
 * the customer side yet. A real customer-facing confirmation belongs on
 * WhatsApp, matching how the rest of this app already talks to customers —
 * that needs the Meta WhatsApp Business API and its own verification, out
 * of scope here. The owner, by contrast, already has a real email
 * (`AppUser.email`, used to log in), so that's what this wires today. This
 * also closes a real gap: order.service.ts and appointment.service.ts both
 * already write a `BusinessNotification` row on every new order/booking,
 * but nothing previously read, displayed, or emailed it — a dead write
 * until now.
 */
/** Minimal HTML-escaping for merchant/customer-supplied strings (product names, addresses) landing in an email body. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export interface OrderEmailItem {
  name: string
  quantity: number
  /** Food Menu Domain Foundation §17 — resolved, customer-facing option NAMES only ("Large", "Cheese") — never raw ids/JSON. Omitted/empty for a simple item with no configured options. */
  options?: string[]
}

/** A basket order's items rendered as a plain list — "2 × Kota Special" per line, with any selected options as a short indented line beneath (§17). Omitted entirely when `items` isn't passed, so every existing call site (and test) keeps rendering exactly as before. */
function itemsListHtml(items?: OrderEmailItem[]): string {
  if (!items || items.length === 0) return ''
  const rows = items
    .map((i) => {
      const optionsLine =
        i.options && i.options.length > 0
          ? `<div style="color:#B7A98C;font-size:13px;margin-top:2px;">${i.options.map(escapeHtml).join(', ')}</div>`
          : ''
      return `<li style="color:#8A7B68;font-size:14px;line-height:1.6;">${i.quantity} &times; ${escapeHtml(i.name)}${optionsLine}</li>`
    })
    .join('')
  return `<ul style="margin:0 0 16px;padding-left:20px;">${rows}</ul>`
}

function fulfilmentLineHtml(fulfilmentMethod?: 'COLLECTION' | 'DELIVERY'): string {
  if (!fulfilmentMethod) return ''
  const label = fulfilmentMethod === 'DELIVERY' ? 'Delivery' : 'Collection'
  return `<p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">${label}</p>`
}

export function newOrderEmail(opts: {
  businessName: string
  orderNumber: string
  totalFormatted: string
  items?: OrderEmailItem[]
  fulfilmentMethod?: 'COLLECTION' | 'DELIVERY'
}): { subject: string; html: string } {
  return {
    subject: `New order — ${opts.orderNumber}`,
    html: wrapper(`
      <h1 style="color:#F5EFE6;font-size:20px;margin:0 0 12px;">New order at ${opts.businessName}</h1>
      <p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">
        Order <strong style="color:#F5EFE6;">${opts.orderNumber}</strong> for
        <strong style="color:#E8A020;">${opts.totalFormatted}</strong> just came in from your storefront.
      </p>
      ${itemsListHtml(opts.items)}
      ${fulfilmentLineHtml(opts.fulfilmentMethod)}
    `),
  }
}

/**
 * The customer-facing counterpart to newOrderEmail (which notifies the
 * owner). Only sent when the customer supplied an email at checkout —
 * most won't have, which is fine (see registerCustomer's `email` param).
 * WhatsApp confirmation would be the more natural channel for this app's
 * phone-first identity model, but that needs the Meta WhatsApp Business
 * API and its own verification — out of scope here, not faked.
 */
export function customerOrderConfirmationEmail(opts: {
  businessName: string
  orderNumber: string
  totalFormatted: string
  items?: OrderEmailItem[]
  fulfilmentMethod?: 'COLLECTION' | 'DELIVERY'
  /** The customer's own delivery page (holds their drop-off code). Customer emails only — never the shop's. */
  deliveryUrl?: string | null
}): { subject: string; html: string } {
  return {
    subject: `Your order at ${opts.businessName} — ${opts.orderNumber}`,
    html: wrapper(`
      <h1 style="color:#F5EFE6;font-size:20px;margin:0 0 12px;">Thanks for your order!</h1>
      <p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">
        Order <strong style="color:#F5EFE6;">${opts.orderNumber}</strong> at
        <strong style="color:#F5EFE6;">${opts.businessName}</strong> for
        <strong style="color:#E8A020;">${opts.totalFormatted}</strong> has been received.
      </p>
      ${itemsListHtml(opts.items)}
      ${fulfilmentLineHtml(opts.fulfilmentMethod)}
      ${
        opts.deliveryUrl
          ? `<p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">
        Track your delivery here — if a Skhokholetha driver delivers it, your delivery code will appear on this page.
        Give the code to the driver only once your order is in your hands. Please don't forward this email.<br />
        <a href="${escapeHtml(opts.deliveryUrl)}" style="color:#E8A020;">Your delivery page</a>
      </p>`
          : ''
      }
    `),
  }
}

/** The customer-facing order milestones that get a message. */
export type CustomerOrderStatus = 'CONFIRMED' | 'READY_FOR_COLLECTION' | 'DRIVER_ASSIGNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED'

const STATUS_COPY: Record<CustomerOrderStatus, { subject: (n: string) => string; heading: string; body: (biz: string) => string }> = {
  CONFIRMED: { subject: (n) => `Order ${n} confirmed`, heading: 'Your order is confirmed', body: (b) => `${b} has accepted your order and is getting it ready.` },
  READY_FOR_COLLECTION: { subject: (n) => `Order ${n} is ready to collect`, heading: 'Ready to collect', body: (b) => `Your order is ready — come and fetch it at ${b}.` },
  DRIVER_ASSIGNED: { subject: (n) => `Order ${n}: a driver is on the way to the shop`, heading: 'A driver has been assigned', body: (b) => `A driver is heading to ${b} to collect your order.` },
  OUT_FOR_DELIVERY: { subject: (n) => `Order ${n} is on its way`, heading: 'Out for delivery', body: (b) => `Your order from ${b} is on its way to you.` },
  DELIVERED: { subject: (n) => `Order ${n} delivered`, heading: 'Delivered', body: (b) => `Your order from ${b} has been delivered. Enjoy!` },
  CANCELLED: { subject: (n) => `Order ${n} was cancelled`, heading: 'Order cancelled', body: (b) => `${b} has cancelled this order. If you already paid, the shop will arrange your refund.` },
}

/**
 * Customer status update — sent only to the address typed at checkout for
 * THIS order. Never carries a delivery code or tracking token; the customer
 * already holds their own delivery page from the confirmation email.
 */
export function customerOrderStatusEmail(opts: {
  status: CustomerOrderStatus
  businessName: string
  orderNumber: string
  fulfilmentMethod: 'COLLECTION' | 'DELIVERY'
  /** The shop's contact number for questions, if it has one. */
  contact: string | null
  /** Tab 5 — one extra sentence from the merchant's decision: the ETA on acceptance, the reason on cancellation. */
  detail?: string | null
}): { subject: string; html: string; text: string } {
  const copy = STATUS_COPY[opts.status]
  const body = [copy.body(opts.businessName), opts.detail?.trim()].filter(Boolean).join(' ')
  const contactLine = opts.contact ? `Questions? Contact ${opts.businessName} on ${opts.contact}.` : ''
  return {
    subject: copy.subject(opts.orderNumber),
    text: `${copy.heading}

Order ${opts.orderNumber} at ${opts.businessName}.
${body}
${contactLine}`.trim(),
    html: wrapper(`
      <h1 style="color:#F5EFE6;font-size:20px;margin:0 0 12px;">${escapeHtml(copy.heading)}</h1>
      <p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">
        Order <strong style="color:#F5EFE6;">${escapeHtml(opts.orderNumber)}</strong> at
        <strong style="color:#F5EFE6;">${escapeHtml(opts.businessName)}</strong>.<br />
        ${escapeHtml(body)}
      </p>
      ${contactLine ? `<p style="color:#8A7B68;font-size:13px;line-height:1.6;margin:0;">${escapeHtml(contactLine)}</p>` : ''}
    `),
  }
}

export function customerBookingConfirmationEmail(opts: {
  businessName: string
  serviceName: string
  whenFormatted: string
}): { subject: string; html: string } {
  return {
    subject: `Your booking at ${opts.businessName} — ${opts.serviceName}`,
    html: wrapper(`
      <h1 style="color:#F5EFE6;font-size:20px;margin:0 0 12px;">Booking confirmed</h1>
      <p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">
        <strong style="color:#F5EFE6;">${opts.serviceName}</strong> at
        <strong style="color:#F5EFE6;">${opts.businessName}</strong> is booked for
        <strong style="color:#E8A020;">${opts.whenFormatted}</strong>.
      </p>
    `),
  }
}

export function newBookingEmail(opts: {
  businessName: string
  serviceName: string
  whenFormatted: string
}): { subject: string; html: string } {
  return {
    subject: `New booking — ${opts.serviceName}`,
    html: wrapper(`
      <h1 style="color:#F5EFE6;font-size:20px;margin:0 0 12px;">New booking at ${opts.businessName}</h1>
      <p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">
        <strong style="color:#F5EFE6;">${opts.serviceName}</strong> was just booked for
        <strong style="color:#E8A020;">${opts.whenFormatted}</strong>.
      </p>
    `),
  }
}

/** Simple account emails with the same content in HTML and plain text. */
function accountEmail(subject: string, paragraphs: string[], url: string): { subject: string; html: string; text: string } {
  const text = ['Skhokho', ...paragraphs, url, 'Skhokho | Skhokho Labs'].join('\n\n')
  return {
    subject,
    text,
    html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#222;background:#fff;max-width:560px;padding:24px;">
      <p><strong>Skhokho</strong></p>
      ${paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}
      <p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
      <p>Skhokho | Skhokho Labs</p>
    </div>`,
  }
}

export function staffInviteEmail(opts: {
  businessName: string
  setPasswordUrl: string
}): { subject: string; html: string; text: string } {
  return accountEmail(`Your ${opts.businessName} team invitation on Skhokho`, [
    `${opts.businessName} has invited you to join their team on Skhokho.`,
    'Use the link below to set your password and access your staff dashboard. The link expires in 7 days.',
    'If you were not expecting this invitation, check with the business owner before continuing.',
  ], opts.setPasswordUrl)
}

export function passwordResetEmail(opts: { resetUrl: string }): { subject: string; html: string; text: string } {
  return accountEmail('Reset your Skhokho password', [
    'We received a request to reset the password for your Skhokho account.',
    'Use the link below to choose a new password. The link expires in 1 hour.',
    "If you did not request this, you can ignore this email. Your password will stay the same.",
  ], opts.resetUrl)
}

/** Sent to the NEW business contact address only — opening the link is what makes it the shop's public email. */
export function businessEmailVerifyEmail(opts: { businessName: string; verifyUrl: string }): { subject: string; html: string; text: string } {
  return accountEmail(`Confirm the new contact email for ${opts.businessName}`, [
    `Someone asked to make this address the contact email for ${opts.businessName} on Skhokho.`,
    'Use the link below to confirm it. The link expires in 24 hours; until then the old address stays in place.',
    "If this wasn't you, ignore this email and nothing will change.",
  ], opts.verifyUrl)
}

export function driverVerifyEmail(opts: { verifyUrl: string }): { subject: string; html: string; text: string } {
  return accountEmail('Confirm your email for Skhokholetha', [
    'Thanks for signing up to drive with Skhokholetha.',
    'Use the link below to confirm this is your email address. The link expires in 48 hours.',
    "If you didn't sign up, you can ignore this email.",
  ], opts.verifyUrl)
}

/**
 * The email fallback for a customer sign-in code (customer-auth.service.ts)
 * — used when the customer signs in by email, or no phone provider is
 * configured. The code is the whole message; there is nothing to click.
 */
export function customerLoginCodeEmail(opts: { code: string; shopName: string | null }): { subject: string; html: string; text: string } {
  const where = opts.shopName ? ` for ${opts.shopName}` : ''
  const text = ['Skhokho', `Your sign-in code${where} is ${opts.code}.`, "It works for 10 minutes. If you didn't ask for it, just ignore this email.", 'Skhokho | Skhokho Labs'].join('\n\n')
  return {
    subject: `Your Skhokho sign-in code: ${opts.code}`,
    text,
    html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#222;background:#fff;max-width:560px;padding:24px;">
      <p><strong>Skhokho</strong></p>
      <p>Your sign-in code${escapeHtml(where)} is</p>
      <p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:8px 0;">${escapeHtml(opts.code)}</p>
      <p>It works for 10 minutes. If you didn&#39;t ask for it, just ignore this email.</p>
      <p>Skhokho | Skhokho Labs</p>
    </div>`,
  }
}

/** Tells the OWNER a customer cancelled from their account (customer-orders.service.ts). The dashboard notification is the other copy. */
export function ownerOrderCancelledByCustomerEmail(opts: { businessName: string; orderNumber: string; reason: string; note: string | null }): { subject: string; html: string; text: string } {
  const why = `Reason: ${opts.reason}${opts.note ? ` — "${opts.note}"` : ''}`
  const text = ['Skhokho', `The customer cancelled order ${opts.orderNumber} at ${opts.businessName} before you confirmed it.`, why, 'Nothing else to do: if they had paid, their payment is already closed; if not, nothing was charged.', 'Skhokho | Skhokho Labs'].join('\n\n')
  return {
    subject: `Order ${opts.orderNumber} cancelled by the customer`,
    text,
    html: wrapper(`
      <h1 style="color:#F5EFE6;font-size:20px;margin:0 0 12px;">Order cancelled by the customer</h1>
      <p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">
        Order <strong style="color:#F5EFE6;">${escapeHtml(opts.orderNumber)}</strong> at
        <strong style="color:#F5EFE6;">${escapeHtml(opts.businessName)}</strong> was cancelled by the customer before you confirmed it.<br />
        ${escapeHtml(why)}
      </p>
      <p style="color:#8A7B68;font-size:13px;line-height:1.6;margin:0;">Nothing else to do: if they had paid, their payment is already closed; if not, nothing was charged.</p>
    `),
  }
}

/**
 * Platform billing — Skhokho Laboratory invoicing a merchant.
 *
 * Friendly and practical, per docs/specs/2026-10-21-plans.md §7: the amount,
 * the reference, when something changes, and an invitation to reply. These go
 * to businesses whose cash flow is often thinnest exactly at month-end, so
 * there are no threats and no legalese — and never a line implying their shop
 * will stop trading, because it won't.
 *
 * The issuer is named "Skhokho Laboratory" in full wherever money is involved.
 */
export type BillingNoticeStage = 'issued' | 'due_soon' | 'due_today' | 'overdue' | 'final_warning' | 'downgraded'

const BILLING_COPY: Record<BillingNoticeStage, (ctx: { dateLabel: string }) => { subject: string; lead: string; closing: string }> = {
  issued: () => ({
    subject: 'Your Skhokho invoice',
    lead: 'Here is your invoice for this month.',
    closing: 'You can pay by EFT using the reference above.',
  }),
  due_soon: ({ dateLabel }) => ({
    subject: 'Your Skhokho invoice is due soon',
    lead: `A friendly heads-up: your invoice is due on ${dateLabel}.`,
    closing: 'If you have already paid, thank you — you can ignore this.',
  }),
  due_today: () => ({
    subject: 'Your Skhokho invoice is due today',
    lead: 'Your invoice is due today.',
    closing: 'If you have already paid, thank you — you can ignore this.',
  }),
  overdue: ({ dateLabel }) => ({
    subject: 'A reminder about your Skhokho invoice',
    lead: `Your invoice was due on ${dateLabel} and we have not seen it come through yet.`,
    closing: 'If something has come up, reply to this email and we will work it out with you.',
  }),
  final_warning: ({ dateLabel }) => ({
    subject: 'Your Skhokho plan changes on ' + dateLabel,
    lead: `We still have not received this payment. Your paid features stay on until ${dateLabel}, after which your account moves to the Free plan.`,
    closing: 'Your shop, your orders and your customers all stay exactly as they are. Reply any time and we will sort it out.',
  }),
  downgraded: () => ({
    subject: 'Your Skhokho account has moved to Free',
    lead: 'Your account has moved to the Free plan. Nothing has been deleted — your shop, orders, products and customers are all still there.',
    closing: 'Pay the outstanding invoice whenever you are ready and your plan comes straight back.',
  }),
}

export function platformBillingEmail(opts: {
  stage: BillingNoticeStage
  businessName: string
  invoiceNumber: string
  totalFormatted: string
  /** Already formatted for display by the caller. */
  dateLabel: string
  bankingReference: string
}): { subject: string; html: string } {
  const copy = BILLING_COPY[opts.stage]({ dateLabel: opts.dateLabel })
  return {
    subject: copy.subject,
    html: wrapper(`
      <h1 style="color:#F5EFE6;font-size:20px;margin:0 0 12px;">${escapeHtml(opts.businessName)}</h1>
      <p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">${escapeHtml(copy.lead)}</p>
      <p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">
        Invoice <strong style="color:#F5EFE6;">${escapeHtml(opts.invoiceNumber)}</strong> &middot;
        <strong style="color:#E8A020;">${escapeHtml(opts.totalFormatted)}</strong><br />
        Payment reference: <strong style="color:#F5EFE6;">${escapeHtml(opts.bankingReference)}</strong>
      </p>
      <p style="color:#8A7B68;font-size:14px;line-height:1.6;margin:0 0 16px;">${escapeHtml(copy.closing)}</p>
      <p style="color:#B7A98C;font-size:13px;line-height:1.6;margin:0;">Skhokho Laboratory (&ldquo;Skhokho Labs&rdquo;)</p>
    `),
  }
}
