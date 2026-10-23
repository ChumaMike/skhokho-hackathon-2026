/**
 * Storefront basket/checkout pricing — the ONE place a cart of `{productId,
 * quantity, optionIds?}` lines becomes real money. Both the checkout screen's
 * displayed quote and the final order-creation call go through this same
 * function, so a customer is never charged something the checkout UI never
 * showed them (see resolveStorefrontCartQuote's own doc comment).
 *
 * Deliberately separate from order.service.ts's createOrder, which stays a
 * generic, trusted-input function used by POS too — this module is the
 * untrusted-input boundary in front of it, mirroring exactly how the old
 * single-product storefront route re-fetched one product via
 * getActiveProduct before ever calling createOrder. Nothing here is new
 * authoritative money arithmetic beyond what the schema already models —
 * Prisma's own Decimal, used consistently, never plain floating point.
 *
 * Food Menu Domain Foundation (Phase 4) extends this with menu option
 * selections (§11/§12/§13): a client submits only productId/quantity/
 * optionIds — base price, option validity, group constraints, price deltas,
 * and the line total are ALL re-derived here. A line whose configuration
 * can't be fully validated is dropped into `removedLines` (never silently
 * repriced to a cheaper/different configuration) — the same conservative
 * posture the existing NOT_FOUND/INACTIVE_OR_UNAVAILABLE reasons already use.
 */

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { isSoldOut } from '@/modules/catalog/catalog.service'
import {
  getBusinessCapabilities,
  getDeliverySettings,
  getFulfilmentSettings,
  getOrderingSettings,
  type DeliveryPricingMode,
} from '@/modules/tenant/capabilities'
import { getTradingStatus, type TradingState } from '@/modules/tenant/trading-status'
import { computeLineKey } from '@/lib/cart-line-key'
import { geocodeAddress } from '@/lib/geocoding'
import { quoteDeliveryFee, publicZoneTable, type DeliveryQuote } from '@/modules/delivery/delivery-quote'
import { isValidLatLng } from '@/modules/delivery/distance'
import { listActiveZones } from '@/modules/delivery/zones.service'

/** Matches the ceiling the old single-product form already enforced (Math.min(99, ...)) — not a new limit. */
export const MAX_LINE_QUANTITY = 99
/** A generous but real bound on cart size — public request payloads are never unbounded. */
export const MAX_CART_LINES = 40
/** A generous but real bound — matches MenuOptionGroup's own service-layer selection cap. */
const MAX_OPTION_IDS_PER_LINE = 50

export const CartLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  /** Food Menu Domain Foundation — selected MenuOption ids, unordered, deduped before use. Absent/empty for a simple product with no configured options — every pre-Phase-4 cart line keeps working unchanged (§19). */
  optionIds: z.array(z.string().min(1)).max(MAX_OPTION_IDS_PER_LINE).optional(),
})
export type CartLineInput = z.infer<typeof CartLineSchema>

export const CartQuoteRequestSchema = z.object({
  businessId: z.string().uuid(),
  lines: z.array(CartLineSchema).min(1).max(MAX_CART_LINES),
  fulfilmentMethod: z.enum(['COLLECTION', 'DELIVERY']).default('COLLECTION'),
  /** Free-text delivery address — only consulted when fulfilmentMethod is DELIVERY. */
  deliveryAddress: z.string().trim().max(500).optional(),
  /** ZONE pricing: the area the customer picked. Only an id — the fee, name and ownership are resolved server-side. */
  deliveryZoneId: z.string().trim().min(1).max(64).optional(),
})
export type CartQuoteRequest = z.infer<typeof CartQuoteRequestSchema>

export interface QuoteLineOption {
  groupId: string
  groupName: string
  optionId: string
  optionName: string
  /** Decimal string, ZAR — e.g. "15.00". */
  priceDelta: string
}

export interface QuoteLine {
  /** Deterministic identity for this exact product+configuration (§11) — productId alone for a simple line, productId+sorted optionIds otherwise. Stable across requests so the client can match a returned line back to its own cart entry. */
  lineKey: string
  productId: string
  name: string
  /** Decimal string, ZAR — the product's own base price, before option deltas. */
  unitPrice: string
  /** Decimal string, ZAR — unitPrice + the sum of every selected option's priceDelta. What's actually multiplied by quantity. */
  configuredUnitPrice: string
  quantity: number
  lineTotal: string
  /** Empty for a product with no configured options. Never raw ids in customer-facing rendering (§17) — always this resolved name/priceDelta shape. */
  options: QuoteLineOption[]
}

export interface RemovedLine {
  productId: string
  /** Present only when the removed line carried a configuration — lets the UI tell which of several differently-configured lines of the same product was dropped. */
  lineKey?: string
  reason: 'NOT_FOUND' | 'INACTIVE_OR_UNAVAILABLE' | 'INVALID_OPTIONS' | 'SOLD_OUT'
}

export interface AdjustedLine {
  productId: string
  lineKey?: string
  requestedQuantity: number
  adjustedQuantity: number
}

export interface CartQuote {
  businessId: string
  businessName: string
  businessSlug: string
  fulfilmentMethod: 'COLLECTION' | 'DELIVERY'
  lines: QuoteLine[]
  /** A line whose product no longer resolves at all (deleted/deactivated/wrong business), or whose option configuration is no longer valid — dropped from `lines`, reported here so the UI can tell the customer, never silently. */
  removedLines: RemovedLine[]
  /** A line whose requested quantity was capped/reduced — never silently charged for a different quantity than requested without saying so. */
  adjustedLines: AdjustedLine[]
  subtotal: string
  deliveryFee: string
  deliveryAreaInfo?: string
  /** The pricing mode when fulfilmentMethod is DELIVERY — undefined for COLLECTION. */
  deliveryPricingMode?: DeliveryPricingMode
  /** ZONE pricing: every active area with its exact fee, for the checkout picker and the storefront's "Delivery areas" list. */
  deliveryZones?: { id: string; name: string; feeCents: number }[]
  /** ZONE pricing: the area this quote's fee came from (chosen, or matched from the typed address). */
  deliveryZone?: { id: string; name: string }
  /** PER_KM pricing: the road-ish distance the fee was computed from. */
  deliveryDistanceKm?: number
  /** OPEN / CLOSED / PAUSED at quote time — the same source checkout enforces. */
  tradingState: TradingState
  /** True when the customer hasn't yet given what the pricing mode needs (an address for PER_KM, an area for ZONE) — deliveryFee is "0.00" but that is NOT a real quote, the UI must not render it as one. */
  deliveryFeePending?: boolean
  /** Geocoded destination, when resolved — best-effort, used for the tracking map's destination pin. */
  deliveryCoords?: { lat: number; lng: number }
  /** True once ANY of removedLines/adjustedLines is non-empty — "this cart changed since you last saw it, please review again." */
  changed: boolean
  total: string
  deliveryAvailable: boolean
  collectionAvailable: boolean
  generatedAt: string
}

export type QuoteError =
  | { ok: false; code: 'BUSINESS_UNAVAILABLE' }
  | { ok: false; code: 'ORDERS_UNAVAILABLE' }
  | { ok: false; code: 'HOURS_CLOSED' }
  /** The merchant pressed "Pause orders" (ordering.pausedUntil) — temporary, independent of weekly hours. */
  | { ok: false; code: 'ORDERS_PAUSED' }
  /** fulfilment.collectionEnabled is off — a collection request is refused whatever the UI showed. */
  | { ok: false; code: 'COLLECTION_UNAVAILABLE' }
  /** The address/area is not somewhere this business delivers (no matching zone, or beyond maxDistanceKm). */
  | { ok: false; code: 'OUTSIDE_SERVICE_AREA' }
  | { ok: false; code: 'CART_EMPTY' }
  | { ok: false; code: 'BELOW_MINIMUM_ORDER' }
  | { ok: false; code: 'DELIVERY_UNAVAILABLE' }
  /** PER_KM pricing is on, but the business itself has no geocoded location — an owner-configuration problem, not the customer's fault. */
  | { ok: false; code: 'DELIVERY_PRICING_UNAVAILABLE' }
  /** PER_KM pricing is on and a deliveryAddress was submitted, but it could not be geocoded. */
  | { ok: false; code: 'DELIVERY_DISTANCE_UNAVAILABLE' }

export type QuoteResult = { ok: true; quote: CartQuote } | QuoteError

export { computeLineKey } from '@/lib/cart-line-key'

interface ResolvedProductOption {
  optionId: string
  groupId: string
  groupName: string
  optionName: string
  priceDelta: Prisma.Decimal
}

interface ProductOptionCatalog {
  /** Every group assigned to this product, active or not — needed to correctly enforce a required (minSelections > 0) group even when the customer selected nothing from it. */
  groups: {
    groupId: string
    groupName: string
    isActive: boolean
    minSelections: number
    maxSelections: number | null
    options: Map<string, ResolvedProductOption>
  }[]
}

/**
 * Validates one line's selected option ids against the product's real,
 * currently-active configuration (§13). Returns the resolved, priced
 * options on success, or `null` if the configuration cannot be honoured —
 * the caller drops the whole line into removedLines rather than guessing
 * at a partial/cheaper configuration the customer never asked for.
 */
function resolveLineOptions(catalog: ProductOptionCatalog, requestedOptionIds: string[]): ResolvedProductOption[] | null {
  const deduped = [...new Set(requestedOptionIds)]
  const resolved: ResolvedProductOption[] = []
  const selectedByGroup = new Map<string, number>()

  for (const optionId of deduped) {
    let found: ResolvedProductOption | undefined
    let foundGroupActive = false
    for (const group of catalog.groups) {
      const match = group.options.get(optionId)
      if (match) {
        found = match
        foundGroupActive = group.isActive
        break
      }
    }
    // Unknown to this product entirely (never assigned/never existed), or
    // the option's own row isn't in the map because it's inactive (the
    // catalog only contains active options — see buildProductOptionCatalog),
    // or its group is inactive: all three collapse to the same rejection,
    // exactly like getActiveProduct never distinguishing "wrong business"
    // from "doesn't exist" (§13/§25 — a crafted request can't tell which).
    if (!found || !foundGroupActive) return null
    resolved.push(found)
    selectedByGroup.set(found.groupId, (selectedByGroup.get(found.groupId) ?? 0) + 1)
  }

  for (const group of catalog.groups) {
    if (!group.isActive) continue
    const count = selectedByGroup.get(group.groupId) ?? 0
    if (count < group.minSelections) return null // required group not satisfied
    if (group.maxSelections !== null && count > group.maxSelections) return null // over the allowed selection count
  }

  return resolved
}

/**
 * The single authoritative pricing computation. Re-run in full on:
 *  1. checkout entry (so a cart that's been sitting open, or was restored
 *     from localStorage, is priced against the CURRENT catalogue), and
 *  2. immediately before order creation (so a price/availability change in
 *     the gap between (1) and the customer pressing "Place order" can
 *     never be silently charged — see storefront-checkout route, which
 *     compares this fresh quote's `changed` flag before ever calling
 *     order.service.ts's createOrder).
 *
 * Never trusts anything about a line except productId/quantity/optionIds.
 * Every product/service name, price, option validity, and delivery fee is
 * re-derived here, same trust boundary the old single-product route
 * already used.
 */
export async function resolveStorefrontCartQuote(input: CartQuoteRequest): Promise<QuoteResult> {
  const { businessId, lines, fulfilmentMethod, deliveryAddress } = CartQuoteRequestSchema.parse(input)

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      category: true,
      settings: true,
      operatingHours: true,
      latitude: true,
      longitude: true,
    },
  })
  // Generic "unavailable" for both "doesn't exist" and "exists but not
  // ACTIVE" — never reveals which, so a crafted businessId can't be used
  // to probe for a PENDING/SUSPENDED business's existence.
  if (!business || business.status !== 'ACTIVE') return { ok: false, code: 'BUSINESS_UNAVAILABLE' }

  const capabilities = getBusinessCapabilities(business)
  if (!capabilities.has('PRODUCTS') || !capabilities.has('ORDERS')) {
    return { ok: false, code: 'ORDERS_UNAVAILABLE' }
  }

  // One source of truth for "taking orders right now" (trading-status.ts):
  // outside hours → closed; merchant pressed Pause → paused. Fail-open on
  // unconfigured hours, as before.
  const trading = getTradingStatus(business)
  if (trading.state === 'PAUSED') return { ok: false, code: 'ORDERS_PAUSED' }
  if (trading.state === 'CLOSED') return { ok: false, code: 'HOURS_CLOSED' }

  // Fulfilment settings are enforced HERE, at the untrusted boundary — a
  // client posting fulfilmentMethod: COLLECTION to a collection-off shop is
  // refused, whatever the UI showed.
  const fulfilment = getFulfilmentSettings(business)
  if (fulfilmentMethod === 'COLLECTION' && !fulfilment.collectionEnabled) return { ok: false, code: 'COLLECTION_UNAVAILABLE' }
  if (fulfilmentMethod === 'DELIVERY' && !fulfilment.deliveryEnabled) return { ok: false, code: 'DELIVERY_UNAVAILABLE' }

  // Dedupe by lineKey (productId + normalized optionIds) — a client could
  // send the same exact configuration across two lines; only one resolved
  // line per distinct configuration (§11: identical configurations combine,
  // differently-configured lines of the same product never merge).
  interface RequestedLine {
    productId: string
    optionIds: string[]
    quantity: number
  }
  const requestedByKey = new Map<string, RequestedLine>()
  const adjustedLines: AdjustedLine[] = []
  for (const line of lines) {
    const optionIds = [...new Set(line.optionIds ?? [])].sort()
    const key = computeLineKey(line.productId, optionIds)
    const prior = requestedByKey.get(key)
    const combined = (prior?.quantity ?? 0) + line.quantity
    const capped = Math.min(MAX_LINE_QUANTITY, combined)
    if (capped !== combined) {
      adjustedLines.push({ productId: line.productId, lineKey: key, requestedQuantity: combined, adjustedQuantity: capped })
    }
    requestedByKey.set(key, { productId: line.productId, optionIds, quantity: capped })
  }

  const productIds = [...new Set([...requestedByKey.values()].map((l) => l.productId))]
  // businessId is part of the WHERE clause, not a post-filter — a
  // productId belonging to a DIFFERENT business simply never matches and
  // silently lands in removedLines below, exactly like a deleted product.
  // No distinction is ever surfaced between "wrong business" and
  // "doesn't exist" — nothing about another tenant's catalogue leaks.
  const [products, productOptionCatalogs] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds }, businessId, isActive: true },
      select: { id: true, name: true, price: true, soldOutUntil: true },
    }),
    buildProductOptionCatalogs(businessId, productIds),
  ])
  const productById = new Map(products.map((p) => [p.id, p]))

  const quoteLines: QuoteLine[] = []
  const removedLines: RemovedLine[] = []
  let subtotal = new Prisma.Decimal(0)

  for (const [lineKey, { productId, optionIds, quantity }] of requestedByKey) {
    const product = productById.get(productId)
    if (!product) {
      removedLines.push({ productId, lineKey, reason: 'NOT_FOUND' })
      continue
    }
    // Tab 5 — "sold out today" is a merchant control enforced here, at the
    // one authoritative quote, not only by whatever the storefront greys out.
    if (isSoldOut(product.soldOutUntil)) {
      removedLines.push({ productId, lineKey, reason: 'SOLD_OUT' })
      continue
    }

    let resolvedOptions: ResolvedProductOption[] = []
    if (optionIds.length > 0) {
      const catalog = productOptionCatalogs.get(productId) ?? { groups: [] }
      const result = resolveLineOptions(catalog, optionIds)
      if (result === null) {
        removedLines.push({ productId, lineKey, reason: 'INVALID_OPTIONS' })
        continue
      }
      resolvedOptions = result
    } else {
      // Zero selected options is only valid if no group actually REQUIRES a
      // selection — a product with a required "Choose your size" group
      // cannot be added with no size chosen (§13: "required group is
      // satisfied").
      const catalog = productOptionCatalogs.get(productId)
      const hasUnsatisfiedRequiredGroup = catalog?.groups.some((g) => g.isActive && g.minSelections > 0) ?? false
      if (hasUnsatisfiedRequiredGroup) {
        removedLines.push({ productId, lineKey, reason: 'INVALID_OPTIONS' })
        continue
      }
    }

    const deltaSum = resolvedOptions.reduce((sum, o) => sum.add(o.priceDelta), new Prisma.Decimal(0))
    const configuredUnitPrice = product.price.add(deltaSum)
    const lineTotal = configuredUnitPrice.mul(quantity)
    subtotal = subtotal.add(lineTotal)

    quoteLines.push({
      lineKey,
      productId: product.id,
      name: product.name,
      unitPrice: product.price.toFixed(2),
      configuredUnitPrice: configuredUnitPrice.toFixed(2),
      quantity,
      lineTotal: lineTotal.toFixed(2),
      options: resolvedOptions.map((o) => ({
        groupId: o.groupId,
        groupName: o.groupName,
        optionId: o.optionId,
        optionName: o.optionName,
        priceDelta: o.priceDelta.toFixed(2),
      })),
    })
  }

  if (quoteLines.length === 0) return { ok: false, code: 'CART_EMPTY' }

  // Checked against subtotal, not total — a delivery fee inflating the
  // total must never "help" a cart clear a minimum meant to gate how small
  // an order of GOODS can be. Applies to every fulfilment method (pickup
  // and delivery) — see OrderingSettings's own doc comment.
  const ordering = getOrderingSettings(business)
  if (ordering.minOrderCents > 0 && subtotal.lt(new Prisma.Decimal(ordering.minOrderCents).div(100))) {
    return { ok: false, code: 'BELOW_MINIMUM_ORDER' }
  }

  const delivery = getDeliverySettings(business)
  let deliveryFee = new Prisma.Decimal(0)
  let resolvedFulfilment: 'COLLECTION' | 'DELIVERY' = 'COLLECTION'
  let deliveryCoords: { lat: number; lng: number } | undefined
  let deliveryFeePending = false
  let deliveryQuote: DeliveryQuote | undefined
  let zones: Awaited<ReturnType<typeof listActiveZones>> = []

  if (fulfilmentMethod === 'DELIVERY') {
    resolvedFulfilment = 'DELIVERY'
    if (delivery.pricingMode === 'ZONE') zones = await listActiveZones(business.id)
    // Distance pricing with no shop pin is the owner's configuration problem —
    // reported as such before the customer's address is even looked at.
    if (delivery.pricingMode === 'PER_KM' && !isValidLatLng({ lat: business.latitude, lng: business.longitude })) {
      return { ok: false, code: 'DELIVERY_PRICING_UNAVAILABLE' }
    }

    // Geocode once, for the destination pin and (PER_KM) the distance. A
    // failure is only fatal where the fee depends on it.
    if (deliveryAddress) {
      const geo = await geocodeAddress(deliveryAddress)
      if (geo) deliveryCoords = geo
      else if (delivery.pricingMode === 'PER_KM') return { ok: false, code: 'DELIVERY_DISTANCE_UNAVAILABLE' }
    }

    // The ONE delivery-fee rule (delivery-quote.ts) — shared with Skhokholetha.
    const result = quoteDeliveryFee({
      settings: delivery,
      pickup: { lat: business.latitude, lng: business.longitude },
      dropoff: deliveryCoords ?? null,
      zoneId: input.deliveryZoneId ?? null,
      address: deliveryAddress ?? null,
      zones,
    })
    if (!result.ok) {
      if (result.pending) deliveryFeePending = true // address/area not given yet — no fee to show, not an error
      else return { ok: false, code: result.code }
    } else {
      deliveryQuote = result.quote
      deliveryFee = new Prisma.Decimal(result.quote.feeCents).div(100)
      // A zone may carry its own minimum basket (e.g. further areas need a bigger order).
      const zoneMin = result.quote.zone?.minOrderCents ?? 0
      if (zoneMin > 0 && subtotal.lt(new Prisma.Decimal(zoneMin).div(100))) return { ok: false, code: 'BELOW_MINIMUM_ORDER' }
    }
  }

  const total = subtotal.add(deliveryFee)

  return {
    ok: true,
    quote: {
      businessId: business.id,
      businessName: business.name,
      businessSlug: business.slug,
      fulfilmentMethod: resolvedFulfilment,
      lines: quoteLines,
      removedLines,
      adjustedLines,
      subtotal: subtotal.toFixed(2),
      deliveryFee: deliveryFee.toFixed(2),
      deliveryAreaInfo: delivery.areaInfo,
      deliveryPricingMode: fulfilmentMethod === 'DELIVERY' ? delivery.pricingMode : undefined,
      deliveryZones: fulfilmentMethod === 'DELIVERY' && delivery.pricingMode === 'ZONE' ? publicZoneTable(delivery, zones) : undefined,
      deliveryZone: deliveryQuote?.zone ? { id: deliveryQuote.zone.id, name: deliveryQuote.zone.name } : undefined,
      deliveryDistanceKm: deliveryQuote?.distanceKm,
      tradingState: trading.state,
      deliveryFeePending,
      deliveryCoords,
      changed: removedLines.length > 0 || adjustedLines.length > 0,
      total: total.toFixed(2),
      deliveryAvailable: fulfilment.deliveryEnabled,
      collectionAvailable: fulfilment.collectionEnabled,
      generatedAt: new Date().toISOString(),
    },
  }
}

/**
 * One batched fetch for every distinct product in the cart — active groups
 * assigned to each product, with active options only. Built once per quote
 * resolution rather than once per line, so a cart with several
 * differently-configured lines of the same product costs one query, not N.
 */
async function buildProductOptionCatalogs(businessId: string, productIds: string[]): Promise<Map<string, ProductOptionCatalog>> {
  if (productIds.length === 0) return new Map()

  const assignments = await prisma.productOptionGroup.findMany({
    where: { businessId, productId: { in: productIds } },
    include: {
      group: {
        include: {
          options: { where: { isActive: true } },
        },
      },
    },
  })

  const byProduct = new Map<string, ProductOptionCatalog>()
  for (const assignment of assignments) {
    const catalog = byProduct.get(assignment.productId) ?? { groups: [] }
    const optionsMap = new Map<string, ResolvedProductOption>()
    for (const option of assignment.group.options) {
      optionsMap.set(option.id, {
        optionId: option.id,
        groupId: assignment.group.id,
        groupName: assignment.group.name,
        optionName: option.name,
        priceDelta: option.priceDelta,
      })
    }
    catalog.groups.push({
      groupId: assignment.group.id,
      groupName: assignment.group.name,
      isActive: assignment.group.isActive,
      minSelections: assignment.group.minSelections,
      maxSelections: assignment.group.maxSelections,
      options: optionsMap,
    })
    byProduct.set(assignment.productId, catalog)
  }
  return byProduct
}
