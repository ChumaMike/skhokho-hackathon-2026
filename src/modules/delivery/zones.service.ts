/**
 * Delivery zones — merchant-defined areas, each with ONE exact fee. Every
 * read and write is scoped by businessId; a zone id from another business
 * is simply "not found". No area names live in code: the merchant types them.
 */

import { z } from 'zod'
import type { DeliveryZoneMatchKind } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'

export const MAX_ZONES_PER_BUSINESS = 60
export const MAX_SUBURBS_PER_ZONE = 30
const MAX_FEE_CENTS = 100_000 // R1 000 — a sanity cap, not a business rule

export class DeliveryZoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeliveryZoneError'
  }
}

/** Lower-case, single-spaced, no punctuation — the same normalisation for stored suburbs and typed addresses. */
export function normaliseArea(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const ZoneInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the area a name.').max(60),
    matchKind: z.enum(['CUSTOMER_PICK', 'SUBURB_LIST']).default('CUSTOMER_PICK'),
    suburbs: z.array(z.string().trim().min(1).max(60)).max(MAX_SUBURBS_PER_ZONE).default([]),
    feeCents: z.number().int('Fees are whole cents.').min(0, 'A fee cannot be negative.').max(MAX_FEE_CENTS),
    minOrderCents: z.number().int().min(0).max(1_000_000).nullable().default(null),
    active: z.boolean().default(true),
    priority: z.number().int().min(0).max(1000).default(0),
  })
  .strict()
export type ZoneInput = z.infer<typeof ZoneInputSchema>

export const ZONE_SELECT = {
  id: true,
  businessId: true,
  name: true,
  matchKind: true,
  suburbs: true,
  feeCents: true,
  minOrderCents: true,
  active: true,
  priority: true,
  updatedAt: true,
} as const

export type DeliveryZoneRow = {
  id: string
  businessId: string
  name: string
  matchKind: DeliveryZoneMatchKind
  suburbs: string[]
  feeCents: number
  minOrderCents: number | null
  active: boolean
  priority: number
}

export async function listZones(businessId: string): Promise<(DeliveryZoneRow & { updatedAt: Date })[]> {
  return prisma.deliveryZone.findMany({ where: { businessId }, orderBy: [{ priority: 'asc' }, { name: 'asc' }], select: ZONE_SELECT })
}

/** What the storefront and quote use: active zones only, cheapest-first within priority. */
export async function listActiveZones(businessId: string): Promise<DeliveryZoneRow[]> {
  return prisma.deliveryZone.findMany({
    where: { businessId, active: true },
    orderBy: [{ priority: 'asc' }, { feeCents: 'asc' }, { name: 'asc' }],
    select: ZONE_SELECT,
  })
}

function clean(input: ZoneInput) {
  const suburbs = [...new Set(input.suburbs.map(normaliseArea).filter(Boolean))]
  if (input.matchKind === 'SUBURB_LIST' && suburbs.length === 0) throw new DeliveryZoneError('List at least one suburb for this area, or switch it to "customer picks".')
  return { ...input, suburbs }
}

export async function createZone(businessId: string, raw: unknown) {
  const input = clean(ZoneInputSchema.parse(raw))
  const count = await prisma.deliveryZone.count({ where: { businessId } })
  if (count >= MAX_ZONES_PER_BUSINESS) throw new DeliveryZoneError(`You can have up to ${MAX_ZONES_PER_BUSINESS} delivery areas.`)
  const clash = await prisma.deliveryZone.findUnique({ where: { businessId_name: { businessId, name: input.name } }, select: { id: true } })
  if (clash) throw new DeliveryZoneError('You already have an area with that name.')
  return prisma.deliveryZone.create({ data: { businessId, ...input }, select: ZONE_SELECT })
}

export async function updateZone(businessId: string, zoneId: string, raw: unknown) {
  const input = clean(ZoneInputSchema.parse(raw))
  const existing = await prisma.deliveryZone.findFirst({ where: { id: zoneId, businessId }, select: { id: true } })
  if (!existing) throw new DeliveryZoneError('Area not found.')
  const clash = await prisma.deliveryZone.findFirst({ where: { businessId, name: input.name, NOT: { id: zoneId } }, select: { id: true } })
  if (clash) throw new DeliveryZoneError('You already have an area with that name.')
  // updateMany with businessId in the WHERE: the tenant scope is part of the write, not only the pre-check.
  const r = await prisma.deliveryZone.updateMany({ where: { id: zoneId, businessId }, data: input })
  if (r.count !== 1) throw new DeliveryZoneError('Area not found.')
}

export async function setZoneActive(businessId: string, zoneId: string, active: boolean) {
  const r = await prisma.deliveryZone.updateMany({ where: { id: zoneId, businessId }, data: { active } })
  if (r.count !== 1) throw new DeliveryZoneError('Area not found.')
}

/** Move a zone one step up or down in the picker order (priority). */
export async function moveZone(businessId: string, zoneId: string, direction: 'UP' | 'DOWN') {
  const zones = await listZones(businessId)
  const index = zones.findIndex((z) => z.id === zoneId)
  if (index === -1) throw new DeliveryZoneError('Area not found.')
  const swapWith = direction === 'UP' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= zones.length) return
  // Renumber everyone 0..n so priorities stay dense and ties can't reappear.
  const order = zones.map((z) => z.id)
  ;[order[index], order[swapWith]] = [order[swapWith], order[index]]
  await prisma.$transaction(order.map((id, priority) => prisma.deliveryZone.updateMany({ where: { id, businessId }, data: { priority } })))
}

export async function deleteZone(businessId: string, zoneId: string) {
  const r = await prisma.deliveryZone.deleteMany({ where: { id: zoneId, businessId } })
  if (r.count !== 1) throw new DeliveryZoneError('Area not found.')
}

/**
 * The zone an address falls in, by suburb words appearing in the typed
 * address (SUBURB_LIST zones only). Deterministic: longest suburb name wins,
 * then priority. Null = no automatic match (the customer picks).
 */
export function matchZoneByAddress(zones: DeliveryZoneRow[], address: string): DeliveryZoneRow | null {
  const haystack = ` ${normaliseArea(address)} `
  if (!haystack.trim()) return null
  let best: { zone: DeliveryZoneRow; length: number } | null = null
  for (const zone of zones) {
    if (!zone.active || zone.matchKind !== 'SUBURB_LIST') continue
    for (const suburb of zone.suburbs) {
      if (suburb && haystack.includes(` ${suburb} `)) {
        if (!best || suburb.length > best.length || (suburb.length === best.length && zone.priority < best.zone.priority)) {
          best = { zone, length: suburb.length }
        }
      }
    }
  }
  return best?.zone ?? null
}
