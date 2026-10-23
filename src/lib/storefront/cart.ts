/**
 * Storefront basket — unauthenticated, temporary CLIENT state only. No Cart/
 * CartItem DB tables: the basket becomes real data (Order + OrderItems) only
 * once the customer actually places the order (see storefront-cart.ts,
 * order.service.ts). This module is pure, framework-free logic so it's
 * directly unit-testable; useCart.ts wraps it as a React hook.
 *
 * Deliberately minimal persisted shape — productId + quantity (+ optionIds
 * for a configured Food Menu item, Phase 4 §11) only. Never name/price/total
 * (the UI reads those from the catalogue it already has; the server is
 * always authoritative at checkout) and never phone/email/address/consent/
 * payment data (see useCheckoutDraft, which is intentionally NOT persisted
 * at all).
 *
 * Namespaced per business (`skhokho:cart:v1:<businessId>`) — every
 * /store/[slug] storefront shares one browser origin, so a bare
 * "skhokho:cart" key would leak Business A's basket into Business B's page.
 *
 * Cart-LINE identity (Phase 4 §11) is productId + normalized selected
 * option ids (see computeLineKey, shared with the server's authoritative
 * quote resolver) — a product with no configured options resolves to a key
 * equal to its own productId, so every pre-Phase-4 persisted cart entry
 * remains a valid, correctly-keyed line with zero migration (§19).
 */

import { computeLineKey } from '@/lib/cart-line-key'

/**
 * Fired on every saveCart — localStorage's own `storage` event never fires
 * in the tab that made the write, so a page mounting more than one useCart
 * instance for the same business (e.g. a nav basket badge alongside a
 * product grid — both legitimate, independent mounts) would otherwise show
 * each instance's own stale snapshot until next navigation. useCart listens
 * for this to re-sync immediately within the same tab.
 */
export const CART_CHANGE_EVENT = 'skhokho:cart:change'

export const CART_SCHEMA_VERSION = 1
/** Mirrors storefront-cart.ts's MAX_LINE_QUANTITY — the same ceiling the old single-product form already enforced. */
export const MAX_LINE_QUANTITY = 99
/** Mirrors storefront-cart.ts's MAX_CART_LINES. */
export const MAX_CART_LINES = 40
/** Mirrors storefront-cart.ts's per-line option cap. */
const MAX_OPTION_IDS_PER_LINE = 50
/** A basket left untouched this long is treated as abandoned, not restored — not a lifecycle subsystem, just a sanity ceiling. */
export const CART_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

export interface CartLine {
  productId: string
  quantity: number
  /** Omitted/empty for a simple item with no configured options. */
  optionIds?: string[]
}

export interface CartState {
  version: typeof CART_SCHEMA_VERSION
  businessId: string
  lines: CartLine[]
  updatedAt: string
}

/** The cart-line identity key for a given line — see this module's doc comment. */
export function lineKeyOf(line: Pick<CartLine, 'productId' | 'optionIds'>): string {
  return computeLineKey(line.productId, line.optionIds)
}

function cartKey(businessId: string): string {
  return `skhokho:cart:v${CART_SCHEMA_VERSION}:${businessId}`
}

function emptyCart(businessId: string): CartState {
  return { version: CART_SCHEMA_VERSION, businessId, lines: [], updatedAt: new Date().toISOString() }
}

function isPlainCartLine(value: unknown): value is { productId: unknown; quantity: unknown; optionIds?: unknown } {
  return typeof value === 'object' && value !== null && 'productId' in value && 'quantity' in value
}

/**
 * Defensively re-validates whatever was actually in storage — a corrupt,
 * hand-edited, or previous-schema-version value never crashes the page; it
 * falls back to an empty cart instead (see the module doc comment's
 * "fail gracefully into an empty in-memory cart" requirement).
 */
function sanitize(raw: unknown, businessId: string): CartState {
  if (typeof raw !== 'object' || raw === null) return emptyCart(businessId)
  const obj = raw as Record<string, unknown>
  if (obj.version !== CART_SCHEMA_VERSION || obj.businessId !== businessId || !Array.isArray(obj.lines)) {
    return emptyCart(businessId)
  }
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined
  const age = updatedAt ? Date.now() - new Date(updatedAt).getTime() : Infinity
  if (!Number.isFinite(age) || age > CART_EXPIRY_MS) return emptyCart(businessId)

  const seen = new Map<string, CartLine>()
  for (const entry of obj.lines) {
    if (!isPlainCartLine(entry)) continue
    if (typeof entry.productId !== 'string' || !entry.productId) continue
    if (typeof entry.quantity !== 'number' || !Number.isInteger(entry.quantity)) continue
    const quantity = Math.max(1, Math.min(MAX_LINE_QUANTITY, entry.quantity))
    let optionIds: string[] | undefined
    if (Array.isArray(entry.optionIds)) {
      const cleaned = entry.optionIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
      if (cleaned.length > 0) optionIds = [...new Set(cleaned)].slice(0, MAX_OPTION_IDS_PER_LINE).sort()
    }
    const line: CartLine = optionIds ? { productId: entry.productId, quantity, optionIds } : { productId: entry.productId, quantity }
    const key = lineKeyOf(line)
    if (!seen.has(key) && seen.size >= MAX_CART_LINES) break
    seen.set(key, line)
  }
  return { version: CART_SCHEMA_VERSION, businessId, lines: [...seen.values()], updatedAt: updatedAt ?? new Date().toISOString() }
}

export function loadCart(businessId: string): CartState {
  if (typeof window === 'undefined') return emptyCart(businessId)
  try {
    const raw = window.localStorage.getItem(cartKey(businessId))
    if (!raw) return emptyCart(businessId)
    return sanitize(JSON.parse(raw), businessId)
  } catch {
    // Corrupt JSON, or localStorage unavailable/blocked entirely (private
    // browsing, storage quota, a hardened browser setting) — never let
    // ordering depend on browser storage working.
    return emptyCart(businessId)
  }
}

export function saveCart(cart: CartState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(cartKey(cart.businessId), JSON.stringify(cart))
  } catch {
    // Storage full/blocked — the in-memory React state for THIS page load
    // still works; it just won't survive a refresh. Never throw.
  }
  // Dispatched even if the write above failed — a sibling useCart instance
  // re-reading the same (unchanged) storage value is a harmless no-op, and
  // the instance that called saveCart already has the correct value in its
  // own React state regardless. Same never-throw discipline as the storage
  // write above: a test/SSR environment with a minimal `window` stub (no
  // CustomEvent/dispatchEvent) must never break a real cart write over it.
  try {
    window.dispatchEvent(new CustomEvent(CART_CHANGE_EVENT, { detail: { businessId: cart.businessId } }))
  } catch {
    // Nothing to do if events aren't supported in this environment.
  }
}

export function clearCart(businessId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(cartKey(businessId))
  } catch {
    // Nothing to do if storage itself is unavailable.
  }
}

/**
 * Pure reducer-style helpers — used by both the React hook and its tests
 * directly, no DOM/localStorage involved. `optionIds` defaults to
 * undefined, so every pre-Phase-4 call site (`withLineDelta(cart,
 * productId, delta)`) keeps addressing exactly the simple, unconfigured
 * line for that product — identical behaviour to before (§19).
 */
export function withLineQuantity(cart: CartState, productId: string, quantity: number, optionIds?: string[]): CartState {
  const bounded = Math.max(0, Math.min(MAX_LINE_QUANTITY, Math.round(quantity)))
  const key = computeLineKey(productId, optionIds)
  const withoutLine = cart.lines.filter((l) => lineKeyOf(l) !== key)
  const alreadyExisted = withoutLine.length !== cart.lines.length
  const newLine: CartLine = optionIds && optionIds.length > 0 ? { productId, quantity: bounded, optionIds } : { productId, quantity: bounded }
  const lines =
    bounded <= 0
      ? withoutLine
      : withoutLine.length >= MAX_CART_LINES && !alreadyExisted
        ? withoutLine // already at the line-count ceiling and this would be a genuinely new line — drop silently rather than exceed it
        : [...withoutLine, newLine]
  return { ...cart, lines, updatedAt: new Date().toISOString() }
}

export function withLineDelta(cart: CartState, productId: string, delta: number, optionIds?: string[]): CartState {
  const current = quantityOfLine(cart, productId, optionIds)
  return withLineQuantity(cart, productId, current + delta, optionIds)
}

/** Quantity of the specific configuration (productId + optionIds) — 0 if that exact line isn't in the cart, even if a DIFFERENTLY-configured line of the same product is. */
export function quantityOfLine(cart: CartState, productId: string, optionIds?: string[]): number {
  const key = computeLineKey(productId, optionIds)
  return cart.lines.find((l) => lineKeyOf(l) === key)?.quantity ?? 0
}

/** Every distinct line for a given product, regardless of configuration — e.g. two differently-configured Kotas both show up here. */
export function linesForProduct(cart: CartState, productId: string): CartLine[] {
  return cart.lines.filter((l) => l.productId === productId)
}

export function removeLineByKey(cart: CartState, lineKey: string): CartState {
  return { ...cart, lines: cart.lines.filter((l) => lineKeyOf(l) !== lineKey), updatedAt: new Date().toISOString() }
}

export function cartLineCount(cart: CartState): number {
  return cart.lines.reduce((sum, l) => sum + l.quantity, 0)
}
