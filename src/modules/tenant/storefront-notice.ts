/**
 * Canned copy for the storefront's `?ok=` success banner, keyed by a fixed
 * set of server-chosen tokens.
 *
 * `ok` is a public GET parameter — anyone can put any value in it by hand.
 * Never render it as free text (reflected content injection: a crafted link
 * could make the real storefront display attacker-chosen "confirmation"
 * copy, e.g. a fake payment-failure message with a scam phone number). Every
 * caller that redirects here must pick one of these fixed keys; the page
 * only ever shows the matching canned string, defaulting to ORDER_MESSAGES.order
 * for anything unrecognised.
 */
export const OK_MESSAGES = {
  order: "Order placed — the business will be in touch.",
  booking: "Booking requested — the business will confirm.",
  "order-collection": "Order placed — pay when you collect.",
  "order-delivery": "Order placed — pay the driver when it arrives.",
  lead: "Sent — the business has your request and will come back to you.",
} as const;

export type StorefrontOkKey = keyof typeof OK_MESSAGES;
