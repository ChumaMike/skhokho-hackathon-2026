/**
 * The WhatsApp template catalogue — every message the platform may START a
 * WhatsApp conversation with, as Meta requires it: a named, pre-approved
 * template with numbered variables, never free text.
 *
 * WhatsApp's rule: a business may only write freely to a customer inside
 * the 24 hours after that customer last wrote to it. Everything the platform
 * sends is business-initiated (an order moved, a sign-in was requested), so
 * everything here is a template. Free text is used in one place only — the
 * reply to a customer's own STOP / START (the webhook route), which is
 * inside that window by definition.
 *
 * The provider receives what every phone provider receives: a kind and the
 * plain text from ./templates.ts (the messaging seam is shared by three
 * channels and the callers are not WhatsApp-aware). So the template is
 * DERIVED from that text: templateFromText() recognises the exact sentence
 * shapes customerOrderStatusText / customerOrderPlacedText produce and
 * lifts the facts (order number, shop, contact, total…) back out as
 * template variables. The patterns are generated from those very
 * functions, so a wording change there fails the unit test here instead of
 * silently sending the wrong template.
 *
 * docs/notifications-whatsapp.md carries the exact text to submit to Meta;
 * the unit test checks the doc against this file so the two cannot drift.
 * The names below are what the provider sends; they must match what was
 * approved in WhatsApp Manager character for character.
 */

import type { MessageKind } from './provider'
import { customerOrderStatusText } from './templates'
import type { CustomerOrderStatus } from '@/lib/email'

export type WhatsAppTemplateKey =
  | 'order_placed'
  | 'order_placed_delivery'
  | 'order_confirmed'
  | 'order_ready_for_collection'
  | 'order_driver_assigned'
  | 'order_out_for_delivery'
  | 'order_delivered'
  | 'order_cancelled'
  | 'login_code'

export interface WhatsAppTemplateButton {
  /** What the customer sees on the button (Meta: 25 characters max). */
  label: string
  /**
   * 'url': a dynamic URL button — `urlBase` ends in {{1}} and the button's
   * value is the suffix the provider sends. 'copy_code': the one-tap copy
   * button on an authentication template; its value is the code itself.
   */
  type: 'url' | 'copy_code'
  urlBase?: string
}

export interface WhatsAppTemplateSpec {
  key: WhatsAppTemplateKey
  /** The template name as submitted to Meta: lowercase letters, digits and underscores only. */
  name: string
  category: 'UTILITY' | 'AUTHENTICATION'
  language: 'en'
  /** Body text with positional variables {{1}}, {{2}} … exactly as submitted (Meta: 1024 characters max). */
  body: string
  /** What each positional variable means, in order — for the doc and for whoever fills the submission form. */
  variables: readonly string[]
  /** Sample values Meta asks for at submission, one per variable, in order. */
  samples: readonly string[]
  /** Fixed footer, no variables (Meta: 60 characters max). */
  footer?: string
  /** Meta: at most two URL buttons; one copy-code button. */
  buttons?: readonly WhatsAppTemplateButton[]
}

/** What the provider sends: the catalogue entry resolved to values. */
export interface WhatsAppTemplateMessage {
  key: WhatsAppTemplateKey
  name: string
  language: string
  category: 'utility' | 'authentication'
  /** Body variables, in {{n}} order. */
  variables: string[]
  /** One value per button, in order: a URL suffix, or the code for a copy-code button. */
  buttons: string[]
}

/** Every utility template ends with the same way out — STOP must always work (docs/legal/consent-wording.md). */
export const STOP_FOOTER = 'Reply STOP to stop WhatsApp order updates.'

/**
 * Plain-text replies to a customer's own STOP / START — the one place free
 * text is right, because the customer has just written to us. Wording from
 * docs/legal/consent-wording.md ("STOP / withdrawal"), said for the platform
 * number, which serves every shop.
 */
export const STOP_REPLY_TEXT =
  "You said STOP. Done — you won't get WhatsApp order updates from Skhokho shops again. Your orders and rewards are still safe. Reply START if you change your mind."
export const START_REPLY_TEXT =
  "Welcome back. You'll get WhatsApp updates about your orders from Skhokho shops again. Reply STOP any time to stop — free, and we stop right away."

/** Shown instead of a phone number when the shop has given none. */
export const NO_CONTACT_FALLBACK = 'their Skhokho shop page'

/**
 * Dynamic URL buttons need a fixed base at submission time. The platform's
 * own app origin (NEXT_PUBLIC_APP_URL) is that base — the confirmation page
 * and the customer's delivery page both live there, never on a shop's own
 * domain, so one approved template serves every shop.
 */
export const BUTTON_URL_BASE_PLACEHOLDER = '<NEXT_PUBLIC_APP_URL>'

const QUESTIONS = 'Questions? Contact the shop on {{3}}.'
const STATUS_VARIABLES = ['order number', 'shop name', 'shop contact number, or "their Skhokho shop page"'] as const
const STATUS_SAMPLES = ['ORD-AB12-CD34', 'Kota Kings', '+27 82 123 4567'] as const

export const WHATSAPP_TEMPLATES: Record<WhatsAppTemplateKey, WhatsAppTemplateSpec> = {
  order_placed: {
    key: 'order_placed',
    name: 'skhokho_order_placed',
    category: 'UTILITY',
    language: 'en',
    body: 'Thanks! Your order {{1}} at {{2}} is in: {{3}}, total {{4}}. Payment: {{5}}. Tap below to see your order.',
    variables: ['order number', 'shop name', '"for collection" or "for delivery"', 'total, e.g. R 1 234.56', 'how to pay, e.g. "pay when you collect" or "paid online"'],
    samples: ['ORD-AB12-CD34', 'Kota Kings', 'for collection', 'R 125.00', 'pay when you collect'],
    footer: STOP_FOOTER,
    buttons: [{ label: 'See my order', type: 'url', urlBase: `${BUTTON_URL_BASE_PLACEHOLDER}/store/order/{{1}}` }],
  },
  order_placed_delivery: {
    key: 'order_placed_delivery',
    name: 'skhokho_order_placed_delivery',
    category: 'UTILITY',
    language: 'en',
    body: 'Thanks! Your order {{1}} at {{2}} is in: {{3}}, total {{4}}. Payment: {{5}}. Tap below to see your order and follow your delivery.',
    variables: ['order number', 'shop name', '"for delivery"', 'total, e.g. R 1 234.56', 'how to pay, e.g. "pay the driver when it arrives" or "paid online"'],
    samples: ['ORD-AB12-CD34', 'Kota Kings', 'for delivery', 'R 145.00', 'paid online'],
    footer: STOP_FOOTER,
    buttons: [{ label: 'Follow my delivery', type: 'url', urlBase: `${BUTTON_URL_BASE_PLACEHOLDER}/delivery/{{1}}` }],
  },
  order_confirmed: {
    key: 'order_confirmed',
    name: 'skhokho_order_confirmed',
    category: 'UTILITY',
    language: 'en',
    body: `Order {{1}}: {{2}} has confirmed your order and is getting it ready. ${QUESTIONS}`,
    variables: STATUS_VARIABLES,
    samples: STATUS_SAMPLES,
    footer: STOP_FOOTER,
  },
  order_ready_for_collection: {
    key: 'order_ready_for_collection',
    name: 'skhokho_order_ready',
    category: 'UTILITY',
    language: 'en',
    body: `Order {{1}}: your order is ready. Come and fetch it at {{2}}. ${QUESTIONS}`,
    variables: STATUS_VARIABLES,
    samples: STATUS_SAMPLES,
    footer: STOP_FOOTER,
  },
  order_driver_assigned: {
    key: 'order_driver_assigned',
    name: 'skhokho_order_driver_assigned',
    category: 'UTILITY',
    language: 'en',
    body: `Order {{1}}: a driver is heading to {{2}} to collect your order. ${QUESTIONS}`,
    variables: STATUS_VARIABLES,
    samples: STATUS_SAMPLES,
    footer: STOP_FOOTER,
  },
  order_out_for_delivery: {
    key: 'order_out_for_delivery',
    name: 'skhokho_order_on_its_way',
    category: 'UTILITY',
    language: 'en',
    body: `Order {{1}}: your order from {{2}} is on its way to you. ${QUESTIONS}`,
    variables: STATUS_VARIABLES,
    samples: STATUS_SAMPLES,
    footer: STOP_FOOTER,
  },
  order_delivered: {
    key: 'order_delivered',
    name: 'skhokho_order_delivered',
    category: 'UTILITY',
    language: 'en',
    body: `Order {{1}}: your order from {{2}} has been delivered. Enjoy! ${QUESTIONS}`,
    variables: STATUS_VARIABLES,
    samples: STATUS_SAMPLES,
    footer: STOP_FOOTER,
  },
  order_cancelled: {
    key: 'order_cancelled',
    name: 'skhokho_order_cancelled',
    category: 'UTILITY',
    language: 'en',
    body: `Order {{1}}: {{2}} has cancelled this order. If you already paid, the shop will arrange your refund. ${QUESTIONS}`,
    variables: STATUS_VARIABLES,
    samples: STATUS_SAMPLES,
    footer: STOP_FOOTER,
  },
  login_code: {
    key: 'login_code',
    name: 'skhokho_login_code',
    category: 'AUTHENTICATION',
    language: 'en',
    // Meta writes the body of an authentication template itself; this is
    // that fixed text with the "do not share" line and the expiry footer
    // switched on. Shown here for the doc and the tests, not to be typed in.
    body: '{{1}} is your verification code. For your security, do not share this code.',
    variables: ['the 6-digit sign-in code'],
    samples: ['123456'],
    footer: 'This code expires in 10 minutes.',
    buttons: [{ label: 'Copy code', type: 'copy_code' }],
  },
}

export const STATUS_TEMPLATE: Record<CustomerOrderStatus, WhatsAppTemplateKey> = {
  CONFIRMED: 'order_confirmed',
  READY_FOR_COLLECTION: 'order_ready_for_collection',
  DRIVER_ASSIGNED: 'order_driver_assigned',
  OUT_FOR_DELIVERY: 'order_out_for_delivery',
  DELIVERED: 'order_delivered',
  CANCELLED: 'order_cancelled',
}

/** Meta refuses a variable that is empty, or that contains a newline, tab or more than four spaces in a row. */
export function cleanVariable(value: string): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return cleaned || '-'
}

function message(key: WhatsAppTemplateKey, variables: string[], buttons: string[] = []): WhatsAppTemplateMessage {
  const spec = WHATSAPP_TEMPLATES[key]
  return {
    key,
    name: spec.name,
    language: spec.language,
    category: spec.category === 'AUTHENTICATION' ? 'authentication' : 'utility',
    variables: variables.map(cleanVariable),
    buttons: buttons.map(cleanVariable),
  }
}

// ---------------------------------------------------------------------------
// Recognising the plain texts — patterns generated from the text functions
// ---------------------------------------------------------------------------

const N = '\u0000N\u0000'
const B = '\u0000B\u0000'
const C = '\u0000C\u0000'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Turns one rendering of customerOrderStatusText (with sentinels in place
 * of the facts) into a regex that captures them. The first shop-name
 * sentinel is lazy (it sits inside the sentence); a second one — the
 * "Contact <shop> on <number>" tail — is greedy so a shop called "Kota on
 * Main" does not swallow the start of its own number.
 */
function statusPattern(status: CustomerOrderStatus, withContact: boolean): RegExp {
  const rendered = customerOrderStatusText({ status, businessName: B, orderNumber: N, contact: withContact ? C : null })
  let seenShop = false
  const source = escapeRe(rendered)
    .replace(escapeRe(N), '(\\S+)')
    .replace(new RegExp(escapeRe(escapeRe(B)), 'g'), () => {
      const group = seenShop ? '(.+)' : '(.+?)'
      seenShop = true
      return group
    })
    .replace(escapeRe(C), '(.+?)')
  return new RegExp(`^${source}$`)
}

const STATUS_PATTERNS: { status: CustomerOrderStatus; withContact: RegExp; withoutContact: RegExp }[] = (
  Object.keys(STATUS_TEMPLATE) as CustomerOrderStatus[]
).map((status) => ({ status, withContact: statusPattern(status, true), withoutContact: statusPattern(status, false) }))

/** A status text back to its facts, or null if it is not one of ours. */
export function parseOrderStatusText(text: string): { status: CustomerOrderStatus; orderNumber: string; businessName: string; contact: string | null } | null {
  for (const p of STATUS_PATTERNS) {
    const withContact = p.withContact.exec(text)
    if (withContact) {
      const [, orderNumber, businessName, , contact] = withContact
      return { status: p.status, orderNumber, businessName, contact }
    }
    const bare = p.withoutContact.exec(text)
    if (bare) return { status: p.status, orderNumber: bare[1], businessName: bare[2], contact: null }
  }
  return null
}

/**
 * customerOrderPlacedText: "Thanks! Order <n> at <shop> for collection|for
 * delivery, <total>.[ <pay line>] Your order[ and delivery page]: <url>".
 * The URL's last path segment is the button value: the order id (the
 * confirmation page) or the customer's own delivery key — never a code the
 * shop could use.
 */
const PLACED_PATTERN = /^Thanks! Order (\S+) at (.+) (for delivery|for collection), (R [\d .,]+)\.(?: (.+?))? Your order(?: and delivery page)?: (\S+)$/

export function parseOrderPlacedText(text: string): {
  orderNumber: string
  businessName: string
  how: 'for delivery' | 'for collection'
  totalFormatted: string
  paymentMessage: string | null
  url: string
} | null {
  const m = PLACED_PATTERN.exec(text)
  if (!m) return null
  return { orderNumber: m[1], businessName: m[2], how: m[3] as 'for delivery' | 'for collection', totalFormatted: m[4], paymentMessage: m[5] ?? null, url: m[6] }
}

/** "Pay when you collect." → "pay when you collect"; no pay line means it was paid online. */
function paymentVariable(paymentMessage: string | null): string {
  if (!paymentMessage) return 'paid online'
  const p = paymentMessage.replace(/\.$/, '')
  return p.charAt(0).toLowerCase() + p.slice(1)
}

function lastPathSegment(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')
    return path.slice(path.lastIndexOf('/') + 1)
  } catch {
    return url.slice(url.lastIndexOf('/') + 1)
  }
}

/**
 * The template for a message the seam hands to the WhatsApp provider. Null
 * when the text is not one the catalogue knows — the provider then refuses
 * the send with an observable error rather than guessing.
 */
export function templateFromText(kind: MessageKind, text: string): WhatsAppTemplateMessage | null {
  if (kind === 'customer_order_status') {
    const facts = parseOrderStatusText(text)
    if (!facts) return null
    return message(STATUS_TEMPLATE[facts.status], [facts.orderNumber, facts.businessName, facts.contact ?? NO_CONTACT_FALLBACK])
  }
  if (kind === 'customer_order_confirmation') {
    const facts = parseOrderPlacedText(text)
    if (!facts) return null
    const vars = [facts.orderNumber, facts.businessName, facts.how, facts.totalFormatted, paymentVariable(facts.paymentMessage)]
    const key: WhatsAppTemplateKey = facts.url.includes('/delivery/') ? 'order_placed_delivery' : 'order_placed'
    return message(key, vars, [lastPathSegment(facts.url)])
  }
  if (kind === 'customer_login_code') {
    const code = /\b(\d{6})\b/.exec(text)?.[1]
    if (!code) return null
    return message('login_code', [code], [code])
  }
  return null
}

/** Fills {{n}} in a template body — for the doc, the tests and previews. */
export function renderTemplateBody(key: WhatsAppTemplateKey, variables: readonly string[]): string {
  return WHATSAPP_TEMPLATES[key].body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => variables[Number(n) - 1] ?? `{{${n}}}`)
}

/** The spec behind a template name, if the catalogue has it. */
export function templateByName(name: string): WhatsAppTemplateSpec | null {
  return Object.values(WHATSAPP_TEMPLATES).find((t) => t.name === name) ?? null
}
