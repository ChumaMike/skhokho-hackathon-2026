/**
 * Business capabilities — a small typed convention over the existing
 * `Business.settings` JSON column (already in the schema, unused until
 * now — no new table). Category provides DEFAULTS only; an owner can
 * later opt into a capability their category doesn't default to (e.g. a
 * food vendor turning on DELIVERY) without a migration, by writing to the
 * same `settings.capabilities` array `setBusinessCapabilities` manages.
 *
 * Deliberately conservative: DELIVERY is never a category default (a food
 * business must explicitly opt in), and OTHER gets the broadest default
 * set rather than the narrowest, so an unclassified legacy business never
 * loses something it already relies on.
 */

import type { Business, BusinessCategory } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { hasFeature, type Entitlements } from '@/modules/billing/entitlements'
import type { BooleanFeature } from '@/modules/billing/features'

export type BusinessCapability =
  | 'ORDERS'
  | 'PRODUCTS'
  | 'SERVICES'
  | 'BOOKINGS'
  | 'PICKUP'
  | 'DELIVERY'
  | 'LOYALTY'
  | 'INVENTORY'
  | 'STAFF'
  | 'PAYMENTS'
  // Storefront workflows beyond order and book (Tab 7, storefront-workflows/
  // workflows.ts). Each is a form on the storefront that lands as a lead in
  // Dashboard › Enquiries; all four are plan-gated by `advanced_storefront`.
  | 'QUOTES'
  | 'ENQUIRIES'
  | 'PICKUP_REQUESTS'
  | 'CALLBACKS'

const DEFAULT_CAPABILITIES_BY_CATEGORY: Record<BusinessCategory, BusinessCapability[]> = {
  FOOD_VENDOR: ['PRODUCTS', 'ORDERS', 'PICKUP', 'LOYALTY'],
  TUCK_SHOP: ['PRODUCTS', 'ORDERS', 'PICKUP', 'LOYALTY'],
  RETAIL_STORE: ['PRODUCTS', 'ORDERS', 'LOYALTY'],
  // Salons, braiders and nail techs: booking first, with "call me back /
  // put me on the list" for when the diary is full.
  SALON: ['SERVICES', 'BOOKINGS', 'LOYALTY', 'CALLBACKS'],
  HAIR_BRAIDER: ['SERVICES', 'BOOKINGS', 'LOYALTY', 'CALLBACKS'],
  NAIL_TECHNICIAN: ['SERVICES', 'BOOKINGS', 'LOYALTY', 'CALLBACKS'],
  // Walk-in trade plus "come and fetch my car" for mobile valets.
  CAR_WASH: ['SERVICES', 'BOOKINGS', 'LOYALTY', 'PICKUP_REQUESTS', 'CALLBACKS'],
  // A mechanic quotes before booking (see the storefront-websites audit).
  MECHANIC: ['SERVICES', 'BOOKINGS', 'PRODUCTS', 'LOYALTY', 'QUOTES', 'CALLBACKS'],
  // Events and childcare are enquired about with a date and numbers, not booked by the hour.
  EVENTS: ['SERVICES', 'BOOKINGS', 'QUOTES', 'ENQUIRIES'],
  CHILDCARE: ['SERVICES', 'BOOKINGS', 'ENQUIRIES', 'CALLBACKS'],
  // Laundry: a pickup with an address and window, and a quote for bulk or special items.
  LAUNDRY: ['SERVICES', 'ORDERS', 'PICKUP', 'QUOTES', 'PICKUP_REQUESTS'],
  // Deliberately the broadest set, not the narrowest — an unclassified
  // business must never lose functionality it already uses today.
  OTHER: ['PRODUCTS', 'SERVICES', 'ORDERS', 'BOOKINGS', 'LOYALTY', 'QUOTES', 'ENQUIRIES', 'PICKUP_REQUESTS', 'CALLBACKS'],
}

interface BusinessSettings {
  capabilities?: BusinessCapability[]
  delivery?: Partial<DeliverySettings>
  payment?: Partial<PaymentSettings>
  ordering?: Partial<OrderingSettings>
  fulfilment?: Partial<FulfilmentSettings>
}

export interface PaymentSettings {
  /** Whether this business wants card payment taken on its storefront. */
  online: boolean
}

/*
 * Defaults to true so nothing changes for a business that has never touched
 * the setting. It is only half the decision — whether a customer is actually
 * sent to a gateway also depends on the platform having working credentials.
 * resolveCheckoutPayment (modules/orders/checkout-payment.ts) is the single
 * place those two are combined, so "can this order be paid online" is never
 * answered in two places that could disagree.
 */
const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = { online: true }

export function getPaymentSettings(business: { settings: unknown }): PaymentSettings {
  const settings = (business.settings ?? {}) as BusinessSettings
  const payment = settings.payment
  if (!payment || typeof payment.online !== 'boolean') return DEFAULT_PAYMENT_SETTINGS
  return { online: payment.online }
}

/** Merges into whatever else lives in `settings`, same as setDeliverySettings. */
export async function setPaymentSettings(businessId: string, input: PaymentSettings): Promise<void> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { settings: true },
  })
  const existing = (business.settings ?? {}) as BusinessSettings
  await prisma.business.update({
    where: { id: businessId },
    data: { settings: { ...existing, payment: { online: input.online } } },
  })
}

/**
 * Reads an explicit `settings.capabilities` override if one exists;
 * otherwise falls back to the category default. A business with
 * `settings: null` (every business today) resolves exactly its category's
 * default set — nothing hidden, no migration required to keep working.
 *
 * DELIVERY is deliberately NOT decided by the generic `capabilities` array
 * — it's derived solely from `settings.delivery.enabled` (see
 * getDeliverySettings below), so there is exactly one place "has this
 * business turned delivery on" is ever decided, and the two can never
 * drift out of sync. A FOOD_VENDOR's category default never includes it;
 * enabling it always requires an explicit setDeliverySettings call.
 */
export function getBusinessCapabilities(
  business: Pick<Business, 'category'> & { settings: unknown },
): Set<BusinessCapability> {
  const settings = (business.settings ?? {}) as BusinessSettings
  const base =
    Array.isArray(settings.capabilities) && settings.capabilities.length > 0
      ? new Set(settings.capabilities)
      : new Set(DEFAULT_CAPABILITIES_BY_CATEGORY[business.category] ?? DEFAULT_CAPABILITIES_BY_CATEGORY.OTHER)

  if (getDeliverySettings(business).enabled) {
    base.add('DELIVERY')
  } else {
    base.delete('DELIVERY')
  }
  return base
}

/**
 * FLAT   one fee (feeCents)
 * PER_KM distance pricing: baseFeeCents + perKmFeeCents x road km, floored at
 *        minFeeCents, refused beyond maxDistanceKm (stored name kept for every
 *        business that saved it before the extra fields existed; shown as
 *        "Distance" in the UI)
 * ZONE   one exact fee per merchant-defined area (delivery_zones)
 */
export type DeliveryPricingMode = 'FLAT' | 'PER_KM' | 'ZONE'

export interface DeliverySettings {
  enabled: boolean
  /** Defaults to FLAT — critical for every business that saved delivery settings before this mode existed. */
  pricingMode: DeliveryPricingMode
  /** Integer cents — R20.00 = 2000. Unambiguous in JSON, unlike a float Rand value. Used when pricingMode is FLAT. */
  feeCents: number
  /** Integer cents per km — R5.00/km = 500. Used when pricingMode is PER_KM. */
  perKmFeeCents: number
  /** PER_KM: added before the per-km part. 0 for every business configured before this field existed. */
  baseFeeCents: number
  /** PER_KM: never charge less than this. 0 = no floor. */
  minFeeCents: number
  /** PER_KM: refuse addresses further than this by road-ish distance. 0 = no limit (legacy behaviour). */
  maxDistanceKm: number
  areaInfo?: string
}

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  enabled: false,
  pricingMode: 'FLAT',
  feeCents: 0,
  perKmFeeCents: 0,
  baseFeeCents: 0,
  minFeeCents: 0,
  maxDistanceKm: 0,
}
const MAX_DELIVERY_KM = 200
const MAX_AREA_INFO_LENGTH = 300

/**
 * A business with no `settings.delivery` key at all (every business today)
 * resolves to the defaults above — delivery stays off until explicitly
 * turned on, never implied by category. Crucially, a business that saved
 * delivery settings before pricingMode existed has no `pricingMode` key in
 * its stored JSON at all — that must resolve to FLAT, never PER_KM, or every
 * existing delivery-enabled business would silently break at next checkout.
 */
export function getDeliverySettings(business: { settings: unknown }): DeliverySettings {
  const settings = (business.settings ?? {}) as BusinessSettings
  const delivery = settings.delivery
  if (!delivery || typeof delivery.enabled !== 'boolean') return DEFAULT_DELIVERY_SETTINGS
  const cents = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0)
  return {
    enabled: delivery.enabled,
    pricingMode: delivery.pricingMode === 'PER_KM' ? 'PER_KM' : delivery.pricingMode === 'ZONE' ? 'ZONE' : 'FLAT',
    feeCents: cents(delivery.feeCents),
    perKmFeeCents: cents(delivery.perKmFeeCents),
    baseFeeCents: cents(delivery.baseFeeCents),
    minFeeCents: cents(delivery.minFeeCents),
    maxDistanceKm:
      typeof delivery.maxDistanceKm === 'number' && delivery.maxDistanceKm >= 0 && delivery.maxDistanceKm <= MAX_DELIVERY_KM
        ? delivery.maxDistanceKm
        : 0,
    areaInfo: typeof delivery.areaInfo === 'string' ? delivery.areaInfo : undefined,
  }
}

/**
 * pricingMode/perKmFeeCents are optional here, unlike on the DeliverySettings
 * read shape — a second, pre-existing call site (dashboard/storefront/
 * ordering/actions.ts) only ever touched enabled/feeCents/areaInfo and has
 * no pricing-mode UI of its own. Omitting them PRESERVES whatever is
 * already stored (see setDeliverySettings below) rather than silently
 * resetting an owner's PER_KM configuration to FLAT just because they saved
 * from that other page.
 */
export type SetDeliverySettingsInput = Pick<DeliverySettings, 'enabled' | 'feeCents' | 'areaInfo'> &
  Partial<Pick<DeliverySettings, 'pricingMode' | 'perKmFeeCents' | 'baseFeeCents' | 'minFeeCents' | 'maxDistanceKm'>>

/**
 * The only place delivery is turned on/off and priced. Validates server-side
 * regardless of what any form already validated client-side — both fee
 * fields must be non-negative integers (not float Rand values, which would
 * be ambiguous once stored as JSON), areaInfo is trimmed and length-capped.
 * Both fee fields are always written regardless of the active pricingMode,
 * so switching modes back and forth never loses the other mode's
 * previously-entered value. Merges into whatever else already lives in
 * `settings`, same pattern as setBusinessCapabilities.
 */
export async function setDeliverySettings(businessId: string, input: SetDeliverySettingsInput): Promise<void> {
  if (!Number.isInteger(input.feeCents) || input.feeCents < 0) {
    throw new Error('Delivery fee must be a non-negative whole number of cents.')
  }
  if (input.perKmFeeCents !== undefined && (!Number.isInteger(input.perKmFeeCents) || input.perKmFeeCents < 0)) {
    throw new Error('Per-km delivery fee must be a non-negative whole number of cents.')
  }
  // Typed, but checked at runtime too: a caller passing anything else must
  // not store a mode the read path would silently reinterpret.
  if (input.pricingMode !== undefined && !['FLAT', 'PER_KM', 'ZONE'].includes(input.pricingMode)) {
    throw new Error('Delivery pricing must be a flat fee, by distance, or by area.')
  }
  for (const key of ['baseFeeCents', 'minFeeCents'] as const) {
    const v = input[key]
    if (v !== undefined && (!Number.isInteger(v) || v < 0)) throw new Error('Delivery fees must be non-negative whole numbers of cents.')
  }
  if (input.maxDistanceKm !== undefined && (!Number.isFinite(input.maxDistanceKm) || input.maxDistanceKm < 0 || input.maxDistanceKm > MAX_DELIVERY_KM)) {
    throw new Error(`Maximum delivery distance must be between 0 and ${MAX_DELIVERY_KM} km.`)
  }
  if (typeof input.enabled !== 'boolean') {
    throw new Error('Delivery must be switched either on or off.')
  }
  const areaInfo = input.areaInfo?.trim().slice(0, MAX_AREA_INFO_LENGTH) || undefined

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { settings: true },
  })
  const existingDelivery = getDeliverySettings({ settings: business.settings })
  const settings = (business.settings ?? {}) as Record<string, unknown>
  await prisma.business.update({
    where: { id: businessId },
    data: {
      settings: {
        ...settings,
        delivery: {
          enabled: input.enabled,
          pricingMode: input.pricingMode ?? existingDelivery.pricingMode,
          feeCents: input.feeCents,
          perKmFeeCents: input.perKmFeeCents ?? existingDelivery.perKmFeeCents,
          baseFeeCents: input.baseFeeCents ?? existingDelivery.baseFeeCents,
          minFeeCents: input.minFeeCents ?? existingDelivery.minFeeCents,
          maxDistanceKm: input.maxDistanceKm ?? existingDelivery.maxDistanceKm,
          areaInfo,
        },
      },
    },
  })
}

export interface OrderingSettings {
  /** Integer cents — same "never a float Rand value" discipline as DeliverySettings.feeCents. 0 means no minimum. Applies to every order regardless of fulfilment method (pickup AND delivery) — a minimum order is a kitchen-economics concept, not a delivery-logistics one, so it lives as its own settings key rather than nested under `delivery`. */
  minOrderCents: number
  /** "Pause orders now": ISO instant until which NO new orders are taken, whatever the weekly hours say. Null/past = not paused. */
  pausedUntil: string | null
  /** Tab 5 — typical preparation time in whole minutes (0 = not set), shown as the ETA on confirmations. Read tolerant of absence. */
  prepMinutes: number
}

const DEFAULT_ORDERING_SETTINGS: OrderingSettings = { minOrderCents: 0, pausedUntil: null, prepMinutes: 0 }
export const MAX_PREP_MINUTES = 240
/** A pause is a short operational breather, never a way to close for a week — opening hours are for that. */
export const MAX_PAUSE_HOURS = 24

/** A business with no `settings.ordering` key at all (every business today) resolves to no minimum and no pause — zero behaviour change until an owner explicitly sets one. */
export function getOrderingSettings(business: { settings: unknown }): OrderingSettings {
  const settings = (business.settings ?? {}) as BusinessSettings
  const ordering = settings.ordering
  if (!ordering) return DEFAULT_ORDERING_SETTINGS
  const minOrderCents = Number.isInteger(ordering.minOrderCents) && ordering.minOrderCents! >= 0 ? ordering.minOrderCents! : 0
  const pausedUntil =
    typeof ordering.pausedUntil === 'string' && !Number.isNaN(Date.parse(ordering.pausedUntil))
      ? new Date(ordering.pausedUntil).toISOString()
      : null
  const prepMinutes =
    Number.isInteger(ordering.prepMinutes) && ordering.prepMinutes! >= 0 && ordering.prepMinutes! <= MAX_PREP_MINUTES ? ordering.prepMinutes! : 0
  return { minOrderCents, pausedUntil, prepMinutes }
}

/** Same validation and merge-preserving update pattern as setDeliverySettings. Minimum and/or prep time — pausing has its own function below. */
export async function setOrderingSettings(
  businessId: string,
  input: Partial<Pick<OrderingSettings, 'minOrderCents' | 'prepMinutes'>>,
): Promise<void> {
  const patch: Partial<OrderingSettings> = {}
  if (input.minOrderCents !== undefined) {
    if (!Number.isInteger(input.minOrderCents) || input.minOrderCents < 0) {
      throw new Error('Minimum order amount must be a non-negative whole number of cents.')
    }
    patch.minOrderCents = input.minOrderCents
  }
  if (input.prepMinutes !== undefined) {
    if (!Number.isInteger(input.prepMinutes) || input.prepMinutes < 0 || input.prepMinutes > MAX_PREP_MINUTES) {
      throw new Error(`Preparation time must be a whole number of minutes between 0 and ${MAX_PREP_MINUTES}.`)
    }
    patch.prepMinutes = input.prepMinutes
  }
  if (Object.keys(patch).length === 0) return
  await mergeOrdering(businessId, patch)
}

/**
 * Pause new orders until `until` (at most MAX_PAUSE_HOURS ahead), or resume
 * with null. Weekly hours are untouched — see trading-status.ts.
 */
export async function setOrderingPause(businessId: string, until: Date | null, now: Date = new Date()): Promise<void> {
  if (until !== null) {
    if (!(until instanceof Date) || Number.isNaN(until.getTime())) throw new Error('Choose how long to pause for.')
    const ms = until.getTime() - now.getTime()
    if (ms <= 0) throw new Error('The pause must end in the future.')
    if (ms > MAX_PAUSE_HOURS * 60 * 60 * 1000) {
      throw new Error(`Orders can be paused for up to ${MAX_PAUSE_HOURS} hours — use opening hours to close for longer.`)
    }
  }
  await mergeOrdering(businessId, { pausedUntil: until ? until.toISOString() : null })
}

async function mergeOrdering(businessId: string, patch: Partial<OrderingSettings>): Promise<void> {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } })
  const current = getOrderingSettings({ settings: business.settings })
  const settings = (business.settings ?? {}) as Record<string, unknown>
  await prisma.business.update({
    where: { id: businessId },
    data: { settings: { ...settings, ordering: { ...current, ...patch } } },
  })
}

// ---------------------------------------------------------------------------
// Fulfilment — how customers can receive an order, and who may deliver it
// ---------------------------------------------------------------------------

/** OWN = this business's own staff drivers; NETWORK = Skhokholetha; BOTH = either (own first, network as overflow). */
export type DeliverySource = 'OWN' | 'NETWORK' | 'BOTH'

export interface FulfilmentSettings {
  /** Customers may choose Collection at checkout. */
  collectionEnabled: boolean
  /** Mirror of settings.delivery.enabled — read here so callers have one object. Written through setDeliverySettings. */
  deliveryEnabled: boolean
  deliverySources: DeliverySource
}

/**
 * Backward compatible: a business that has never saved fulfilment settings
 * (every business today) keeps collection on and may use either driver
 * source — exactly what the code allowed before this setting existed.
 */
export function getFulfilmentSettings(business: { settings: unknown }): FulfilmentSettings {
  const settings = (business.settings ?? {}) as BusinessSettings
  const f = settings.fulfilment ?? {}
  const sources: DeliverySource = f.deliverySources === 'OWN' || f.deliverySources === 'NETWORK' ? f.deliverySources : 'BOTH'
  return {
    collectionEnabled: typeof f.collectionEnabled === 'boolean' ? f.collectionEnabled : true,
    deliveryEnabled: getDeliverySettings(business).enabled,
    deliverySources: sources,
  }
}

export function allowsOwnDrivers(business: { settings: unknown }): boolean {
  const f = getFulfilmentSettings(business)
  return f.deliveryEnabled && f.deliverySources !== 'NETWORK'
}

export function allowsNetworkDrivers(business: { settings: unknown }): boolean {
  const f = getFulfilmentSettings(business)
  return f.deliveryEnabled && f.deliverySources !== 'OWN'
}

export async function setFulfilmentSettings(
  businessId: string,
  input: { collectionEnabled: boolean; deliverySources: DeliverySource },
): Promise<void> {
  if (typeof input.collectionEnabled !== 'boolean') throw new Error('Collection must be switched either on or off.')
  if (!['OWN', 'NETWORK', 'BOTH'].includes(input.deliverySources)) {
    throw new Error('Choose who delivers: your own drivers, Skhokholetha, or both.')
  }
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } })
  const settings = (business.settings ?? {}) as Record<string, unknown>
  await prisma.business.update({
    where: { id: businessId },
    data: {
      settings: { ...settings, fulfilment: { collectionEnabled: input.collectionEnabled, deliverySources: input.deliverySources } },
    },
  })
}

// ---------------------------------------------------------------------------
// Modules — the self-service switches in Settings › Modules
// ---------------------------------------------------------------------------

/**
 * The capabilities a merchant may switch on or off themselves. DELIVERY is
 * absent on purpose (it has its own switch and pricing in Settings ›
 * Collection & delivery); STAFF and PAYMENTS are not category modules.
 */
export const SWITCHABLE_MODULES = ['ORDERS', 'PRODUCTS', 'SERVICES', 'BOOKINGS', 'PICKUP', 'LOYALTY', 'INVENTORY'] as const
export type SwitchableModule = (typeof SWITCHABLE_MODULES)[number]

export interface ModuleInfo {
  label: string
  description: string
  /** When set, the business's plan must grant this feature before the module can be switched on. */
  planFeature?: BooleanFeature
}

export const MODULE_INFO: Record<SwitchableModule, ModuleInfo> = {
  ORDERS: { label: 'Orders', description: 'Take orders from your storefront and at the counter.' },
  PRODUCTS: { label: 'Products', description: 'Sell from a catalogue — a menu, shelf items or parts.' },
  SERVICES: { label: 'Services', description: 'List the services you offer, with prices.' },
  BOOKINGS: { label: 'Bookings', description: 'Let customers book a time for a service.' },
  PICKUP: { label: 'Collection', description: 'Customers collect their orders from you.' },
  LOYALTY: { label: 'Loyalty stamps', description: 'Stamp cards and rewards for your regulars.', planFeature: 'loyalty' },
  INVENTORY: { label: 'Stock control', description: 'Track stock levels for the products you sell.' },
}

export function isSwitchableModule(value: string): value is SwitchableModule {
  return (SWITCHABLE_MODULES as readonly string[]).includes(value)
}

/** What the category grants without any switch being touched. */
export function categoryDefaultCapabilities(category: BusinessCategory): BusinessCapability[] {
  return [...(DEFAULT_CAPABILITIES_BY_CATEGORY[category] ?? DEFAULT_CAPABILITIES_BY_CATEGORY.OTHER)]
}

export class ModuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModuleError'
  }
}

/**
 * The pure decision behind a switch. Takes the EFFECTIVE set (category
 * defaults or the stored override), returns the full set to store — never a
 * delta, because an empty stored array reads as "use the defaults" (see
 * getBusinessCapabilities), which would quietly resurrect every default the
 * moment the last module was switched off. DELIVERY is never written: it is
 * derived from settings.delivery alone.
 *
 * Plan first: a module whose feature the plan doesn't grant can't be
 * switched on, whatever the category. Switching OFF is always allowed, except
 * for the last module — a business with nothing switched on is a mistake,
 * not a configuration.
 */
export function applyModuleToggle(
  current: Set<BusinessCapability>,
  module: SwitchableModule,
  enabled: boolean,
  entitlements: Entitlements | null,
): BusinessCapability[] {
  if (!isSwitchableModule(module)) throw new ModuleError('That module cannot be switched here.')
  const info = MODULE_INFO[module]
  if (enabled && info.planFeature && !(entitlements && hasFeature(entitlements, info.planFeature))) {
    throw new ModuleError(`${info.label} isn't included in your plan yet.`)
  }
  const next = new Set(current)
  next.delete('DELIVERY')
  if (enabled) next.add(module)
  else next.delete(module)
  if (!SWITCHABLE_MODULES.some((m) => next.has(m))) {
    throw new ModuleError('Keep at least one module switched on.')
  }
  return [...next].sort()
}

/** Switches one module for a business and stores the resulting full set. */
export async function setBusinessModule(
  businessId: string,
  module: SwitchableModule,
  enabled: boolean,
  entitlements: Entitlements | null,
): Promise<BusinessCapability[]> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { category: true, settings: true },
  })
  const next = applyModuleToggle(getBusinessCapabilities(business), module, enabled, entitlements)
  await setBusinessCapabilities(businessId, next)
  return next
}

/**
 * Explicit opt-in/out, merged into whatever else already lives in
 * `settings` rather than replacing it wholesale. Written by setBusinessModule
 * (Settings › Modules) and by tests; the stored array is always the FULL
 * effective set, never a delta.
 */
export async function setBusinessCapabilities(
  businessId: string,
  capabilities: BusinessCapability[],
): Promise<void> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { settings: true },
  })
  const settings = (business.settings ?? {}) as Record<string, unknown>
  await prisma.business.update({
    where: { id: businessId },
    data: { settings: { ...settings, capabilities } },
  })
}
