/**
 * Catalog Service — products and services, both sides.
 *
 * Public reads (top of file) are deliberately separate in shape from the
 * owner-facing management functions (bottom): the public functions return
 * only active items and customer-facing fields (no costPrice, no internal
 * counts) — safe to expose to an unauthenticated storefront visitor. The
 * owner functions require a `requireStaffPermission`-guarded caller (see
 * the dashboard routes that call them) and return everything, active or not.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { assertCanAdd } from '@/modules/billing/limits'
import { MAX_HASHTAGS, parseHashtags } from '@/lib/storefront/share'

export interface PublicProduct {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  /** Extra gallery images beyond imageUrl — storefront-only use so far is GallerySection. */
  images: string[]
  price: string // Decimal serialised to string — see note on money handling below
  /** Food Menu Domain Foundation §9 — null for an uncategorised item (a valid, common state, §3/§19). */
  categoryId: string | null
  categoryName: string | null
  /** §10 — true when this product has at least one active MenuOptionGroup with active options assigned. Decides whether "Add" opens the configurator or just adds one unit directly. */
  hasOptions: boolean
  /** Tab 5 — listed but not orderable right now ("sold out today"); the storefront shows it, greyed, and the cart refuses it. */
  soldOut: boolean
  /** Tab 7 (social products) — the merchant's hashtags, bare and lower case; empty for most products. */
  hashtags: string[]
}

export interface PublicService {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  price: string
  duration: number | null
}

export interface BusinessCatalog {
  products: PublicProduct[]
  services: PublicService[]
}

/**
 * Active catalog for a business's storefront. Prisma `Decimal` fields are
 * serialised to string here (not left as `Decimal` instances, not converted
 * to `number`) — this is a Server Component boundary, so the value has to
 * survive the RSC serialisation to a Client Component; `formatZAR` in
 * `@/lib/utils` already accepts a string.
 */
export async function getActiveCatalog(businessId: string, now: Date = new Date()): Promise<BusinessCatalog> {
  const [products, services] = await Promise.all([
    prisma.product.findMany({
      where: { businessId, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        imageUrl: true,
        images: true,
        price: true,
        soldOutUntil: true,
        hashtags: true,
        category: { select: { id: true, name: true } },
        // Only whether at least one row exists — the real active-option
        // gate (group active AND has active options) is
        // getActiveOptionGroupsForProduct's job at configure/quote time;
        // this is just "does the Add button need to open the configurator
        // at all," a cheap presentational check.
        optionGroups: { select: { id: true }, take: 1 },
      },
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.service.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true, description: true, imageUrl: true, price: true, duration: true },
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ])

  return {
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      imageUrl: p.imageUrl,
      images: p.images,
      price: p.price.toString(),
      categoryId: p.category?.id ?? null,
      categoryName: p.category?.name ?? null,
      hasOptions: p.optionGroups.length > 0,
      soldOut: isSoldOut(p.soldOutUntil, now),
      hashtags: p.hashtags,
    })),
    services: services.map((s) => ({ ...s, price: s.price.toString() })),
  }
}

/**
 * A single product, active + belonging to the given business, or null.
 * These two functions are the last line of defence before a real order/
 * booking is created (see /api/store/order, /api/store/book) — businessId
 * there comes straight from client form data, so the ACTIVE check has to
 * live here, not just on the storefront *page*: without it, a PENDING or
 * SUSPENDED business's real (still-`isActive`) product/service rows stay
 * orderable through the API even while its storefront page 404s.
 */
export async function getActiveProduct(businessId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId, isActive: true, business: { status: 'ACTIVE' } },
    select: { id: true, name: true, price: true },
  })
  return product ? { ...product, price: product.price.toString() } : null
}

/**
 * The configurator page's read (§10) — same tenant/active-scoping as
 * getActiveProduct, with the extra display fields (description/image) a
 * bare pricing re-fetch doesn't need. Never used for order creation —
 * resolveStorefrontCartQuote (storefront-cart.ts) remains the one
 * authoritative price re-fetch at quote/checkout time.
 */
export async function getActiveProductForConfigurator(businessId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId, isActive: true, business: { status: 'ACTIVE' } },
    select: { id: true, name: true, description: true, imageUrl: true, price: true },
  })
  return product ? { ...product, price: product.price.toString() } : null
}

/** A single service, active + belonging to the given business, or null. See getActiveProduct's note. */
export async function getActiveService(businessId: string, serviceId: string) {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId, isActive: true, business: { status: 'ACTIVE' } },
    select: { id: true, name: true, price: true, duration: true, maxBookings: true },
  })
  return service ? { ...service, price: service.price.toString() } : null
}

// ---------------------------------------------------------------------------
// Owner-facing management — everything below requires an authenticated,
// permission-checked caller. Returns active AND inactive items (the owner
// needs to see what they've turned off, the public storefront doesn't).
// ---------------------------------------------------------------------------

export const CreateProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().nonnegative(),
  sku: z.string().max(100).optional(),
  imageUrl: z.string().url().optional(),
  /** Food Menu Domain Foundation (Phase 4) §3 — optional, one category max
   *  for MVP. `null` explicitly uncategorises; `undefined` leaves it
   *  untouched on update. Tenant-checked in createProduct/updateProduct
   *  below, never trusted as belonging to this business merely because an
   *  id was supplied. */
  categoryId: z.string().nullable().optional(),
  /** Tab 7 (social products) — as typed or as a list; normalised by parseHashtags before it is stored, so the
   *  stored value is always bare, lower case and at most MAX_HASHTAGS long. `undefined` leaves the tags alone on update. */
  hashtags: z.union([z.string().max(600), z.array(z.string().max(60)).max(MAX_HASHTAGS * 4)]).optional(),
})

export const UpdateProductSchema = CreateProductSchema.partial()

export const CreateServiceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().nonnegative(),
  duration: z.number().int().positive().max(24 * 60).optional(),
  imageUrl: z.string().url().optional(),
  /** How many customers can book this same slot at once — see the booking
   * capacity guard in appointment.service.ts's createAppointment. */
  maxBookings: z.number().int().positive().max(999).optional(),
})

export const UpdateServiceSchema = CreateServiceSchema.partial()

/**
 * The owner's list, in STOREFRONT order (featured first, then the owner's own
 * sort order, then name) so "move up / move down" shows exactly what a
 * customer will see. Hidden items stay in place, marked, rather than sinking
 * to the bottom — their position matters the moment they're shown again.
 */
export async function listProductsForOwner(businessId: string, now: Date = new Date()) {
  const products = await prisma.product.findMany({
    where: { businessId },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  })
  return products.map((p) => ({ ...p, price: p.price.toString(), soldOut: isSoldOut(p.soldOutUntil, now) }))
}

// ---------------------------------------------------------------------------
// Tab 5 — merchant controls: sold out today, product sort order
// ---------------------------------------------------------------------------

const SAST = 'Africa/Johannesburg'

/** True while a product's sold-out window is still running. */
export function isSoldOut(soldOutUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return Boolean(soldOutUntil && soldOutUntil.getTime() > now.getTime())
}

/**
 * Midnight at the end of TODAY in South Africa, as an instant. Computed via
 * Intl with an explicit zone (the server runs in UTC) — SAST has no DST, so
 * "today" ends at 22:00 UTC. "Sold out today" clears itself overnight;
 * nobody has to remember to switch it back on.
 */
export function endOfTradingDay(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SAST, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  // Start of today SAST = that date at 00:00 UTC minus the +02:00 offset; end = +24h.
  const startOfDayUtc = Date.UTC(get('year'), get('month') - 1, get('day')) - 2 * 60 * 60 * 1000
  return new Date(startOfDayUtc + 24 * 60 * 60 * 1000)
}

/** Marks a product sold out for the rest of today (or available again). Scoped to the business like every catalogue write. */
export async function setProductSoldOutToday(businessId: string, productId: string, soldOut: boolean, now: Date = new Date()) {
  const product = await prisma.product.findFirst({ where: { id: productId, businessId }, select: { id: true } })
  if (!product) throw new Error('Product not found')
  return prisma.product.update({ where: { id: productId }, data: { soldOutUntil: soldOut ? endOfTradingDay(now) : null } })
}

/**
 * Moves a product one step up or down in the owner's order and renumbers the
 * whole list 0..n-1, so a catalogue created before this control existed (all
 * sortOrder 0) becomes deterministic the first time it is touched. Featured
 * items always list first on the storefront regardless — this orders within
 * that rule, exactly as getActiveCatalog sorts.
 */
export async function moveProduct(businessId: string, productId: string, direction: 'up' | 'down') {
  const products = await prisma.product.findMany({
    where: { businessId },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true },
  })
  const index = products.findIndex((p) => p.id === productId)
  if (index === -1) throw new Error('Product not found')
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= products.length) return
  const order = products.map((p) => p.id)
  ;[order[index], order[target]] = [order[target], order[index]]
  await prisma.$transaction(order.map((id, sortOrder) => prisma.product.update({ where: { id }, data: { sortOrder } })))
}

export async function listServicesForOwner(businessId: string) {
  const services = await prisma.service.findMany({
    where: { businessId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })
  return services.map((s) => ({ ...s, price: s.price.toString() }))
}

/** Tenant-checked category resolution shared by createProduct/updateProduct — `undefined` means "leave untouched", `null` means "explicitly uncategorise", any other value must belong to this business. */
async function resolveCategoryId(businessId: string, categoryId: string | null | undefined): Promise<string | null | undefined> {
  if (categoryId === undefined) return undefined
  if (categoryId === null) return null
  const category = await prisma.productCategory.findFirst({ where: { id: categoryId, businessId } })
  if (!category) throw new Error('Category not found')
  return categoryId
}

export async function createProduct(businessId: string, input: z.infer<typeof CreateProductSchema>) {
  const validated = CreateProductSchema.parse(input)
  // Plan allowance, before anything is written. Only NEW products are
  // restricted: a business over its limit after a downgrade keeps every
  // product it has. See modules/billing/limits.ts.
  await assertCanAdd(businessId, 'max_products')
  const categoryId = await resolveCategoryId(businessId, validated.categoryId)
  return prisma.product.create({
    data: {
      businessId,
      name: validated.name,
      description: validated.description,
      price: validated.price,
      sku: validated.sku,
      imageUrl: validated.imageUrl,
      categoryId: categoryId ?? undefined,
      hashtags: validated.hashtags === undefined ? undefined : parseHashtags(validated.hashtags),
      // No inventory-management screen exists yet to ever seed a real
      // InventoryItem/starting quantity (see the Stock preset's own
      // "no dedicated screen yet" summary) — the schema default of
      // trackStock: true would silently promise stock tracking this
      // product can never actually have, and previously blocked
      // completeOrder forever (see order.service.ts's
      // deductStockForOrderItems). Explicit false until a real inventory
      // flow exists to turn it on deliberately, with real data behind it.
      trackStock: false,
    },
  })
}

export async function createService(businessId: string, input: z.infer<typeof CreateServiceSchema>) {
  const validated = CreateServiceSchema.parse(input)
  await assertCanAdd(businessId, 'max_services')
  return prisma.service.create({
    data: {
      businessId,
      name: validated.name,
      description: validated.description,
      price: validated.price,
      duration: validated.duration,
      imageUrl: validated.imageUrl,
      maxBookings: validated.maxBookings,
    },
  })
}

export async function updateProduct(
  businessId: string,
  productId: string,
  input: z.infer<typeof UpdateProductSchema>,
) {
  const validated = UpdateProductSchema.parse(input)
  const product = await prisma.product.findFirst({ where: { id: productId, businessId } })
  if (!product) throw new Error('Product not found')
  const categoryId = await resolveCategoryId(businessId, validated.categoryId)
  const hashtags = validated.hashtags === undefined ? undefined : parseHashtags(validated.hashtags)
  return prisma.product.update({ where: { id: productId }, data: { ...validated, categoryId, hashtags } })
}

export async function updateService(
  businessId: string,
  serviceId: string,
  input: z.infer<typeof UpdateServiceSchema>,
) {
  const validated = UpdateServiceSchema.parse(input)
  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId } })
  if (!service) throw new Error('Service not found')
  return prisma.service.update({ where: { id: serviceId }, data: validated })
}

export async function setProductActive(businessId: string, productId: string, isActive: boolean) {
  const product = await prisma.product.findFirst({ where: { id: productId, businessId } })
  if (!product) throw new Error('Product not found')
  return prisma.product.update({ where: { id: productId }, data: { isActive } })
}

export async function setServiceActive(businessId: string, serviceId: string, isActive: boolean) {
  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId } })
  if (!service) throw new Error('Service not found')
  return prisma.service.update({ where: { id: serviceId }, data: { isActive } })
}

/**
 * Featured items list first in the storefront catalogue and fill the home
 * page's featured section (getActiveCatalog orders by isFeatured). Scoped to
 * the business like every other catalogue write.
 */
export async function setProductFeatured(businessId: string, productId: string, isFeatured: boolean) {
  const product = await prisma.product.findFirst({ where: { id: productId, businessId } })
  if (!product) throw new Error('Product not found')
  return prisma.product.update({ where: { id: productId }, data: { isFeatured } })
}

export async function setServiceFeatured(businessId: string, serviceId: string, isFeatured: boolean) {
  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId } })
  if (!service) throw new Error('Service not found')
  return prisma.service.update({ where: { id: serviceId }, data: { isFeatured } })
}

/**
 * Hard delete, not soft — OrderItem.productId/serviceId are onDelete:
 * SetNull, so a past order keeps its item's name/price snapshot and just
 * loses the FK link. Nothing else in the schema references a product or
 * service by id, so there's no orphan risk in deleting outright.
 */
export async function deleteProduct(businessId: string, productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, businessId } })
  if (!product) throw new Error('Product not found')
  await prisma.product.delete({ where: { id: productId } })
}

export async function deleteService(businessId: string, serviceId: string) {
  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId } })
  if (!service) throw new Error('Service not found')
  await prisma.service.delete({ where: { id: serviceId } })
}
