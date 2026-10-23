/**
 * Business Service
 *
 * Business onboarding + platform management. Reconciled to the unified schema:
 * one canonical `Business` (no separate Platform/Tenant), a business's own team
 * as `BusinessStaff` + `BusinessRole`, gated by `BusinessSubscription`.
 */

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { BusinessCategory, BusinessStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { normalizeSAPhone } from '@/lib/utils'
import { hashPassword } from '@/modules/auth/auth.service'
import { ALL_PERMISSIONS } from '@/types'
import { STAFF_PRESETS } from '@/modules/staff/staff-presets'
import { isValidTemplateId, GENERATED_TEMPLATE_ID, type StorefrontPageId } from './storefront-templates'
import { classifyBusinessCategory } from './category-classifier'
import { allocateSlug } from './slug.service'

export const CreateBusinessSchema = z.object({
  name: z.string().min(2).max(100),
  category: z.enum([
    'SALON', 'FOOD_VENDOR', 'CAR_WASH', 'RETAIL_STORE', 'TUCK_SHOP', 'MECHANIC',
    'HAIR_BRAIDER', 'NAIL_TECHNICIAN', 'EVENTS', 'CHILDCARE', 'LAUNDRY', 'OTHER',
  ]),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
  suburb: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  postalCode: z.string().optional(),
  description: z.string().optional(),

  owner: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    passwordHash: z.string(), // already hashed by caller
    phone: z.string().optional(),
  }),
})

/**
 * A WhatsApp number is stored in one form, +27XXXXXXXXX, so every wa.me link
 * built from it works. An empty value clears it; anything that isn't a
 * plausible South African number is refused with a message the merchant
 * can act on (rather than saved and silently producing a dead link).
 */
export const WHATSAPP_FORMAT_MESSAGE = 'Enter your WhatsApp number as a South African number, like 082 123 4567.'
const whatsappNumber = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined
    if (value.trim() === '') return null
    const e164 = normalizeSAPhone(value)
    if (!e164) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: WHATSAPP_FORMAT_MESSAGE })
      return z.NEVER
    }
    return e164
  })

export const UpdateBusinessSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: whatsappNumber,
  address: z.string().optional(),
  suburb: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  postalCode: z.string().optional(),
  logoUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  operatingHours: z.record(z.any()).optional(),
  settings: z.record(z.any()).optional(),
})

// ---------------------------------------------------------------------------
// Create a business (onboarding) — business + FREE subscription + roles + owner
// ---------------------------------------------------------------------------

/**
 * Registration runs business + subscription + roles + owner staff as ONE
 * interactive transaction (atomic sign-up). Generous on purpose: Neon's
 * serverless compute can take seconds to wake on the first query, and this
 * is the one path where a timeout turns into a lost merchant. Exported so a
 * unit test can assert the options really reach Prisma.
 */
export const CREATE_BUSINESS_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const

export async function createBusiness(input: z.infer<typeof CreateBusinessSchema>) {
  const validated = CreateBusinessSchema.parse(input)

  // Category auto-detection (§Phase 4) — only ever applies when the owner
  // picked "Something else" (OTHER) AND typed a description; a real
  // dropdown pick is always trusted as-is, never second-guessed. A
  // classification failure/timeout/absence leaves category exactly as
  // submitted (OTHER) — this can never block or alter signup outcome.
  let category = validated.category as BusinessCategory
  if (category === 'OTHER' && validated.description) {
    const classification = await classifyBusinessCategory(validated.description)
    if (classification) category = classification.category
  }

  // Hashed before the transaction — bcrypt is deliberately slow.
  const ownerStaffHash = await hashPassword(randomBytes(32).toString('hex'))

  return prisma.$transaction(
    async (tx) => {
    // Deterministic, policy-checked, and claimed under the slug lock inside
    // this same transaction — see slug.service.ts.
    const slug = await allocateSlug(tx, validated.name, { suburb: validated.suburb, city: validated.city })
    const business = await tx.business.create({
      data: {
        name: validated.name,
        slug,
        category,
        email: validated.email,
        phone: validated.phone,
        whatsapp: validated.whatsapp,
        address: validated.address,
        suburb: validated.suburb,
        city: validated.city,
        province: validated.province,
        postalCode: validated.postalCode,
        description: validated.description,
        status: 'PENDING_VERIFICATION',
      },
    })

    // No planId: a subscription without one is on the default plan (see
    // modules/billing/entitlements.ts) — no plan code is named here.
    await tx.businessSubscription.create({ data: { businessId: business.id } })

    const ownerRole = await tx.businessRole.create({
      data: {
        businessId: business.id,
        name: 'Owner',
        isDefault: false,
        presetRole: 'OWNER',
        // Prisma's Json input type wants an index signature StaffPermissions
        // (a closed, fully-typed interface) intentionally doesn't have —
        // same widening `guards.ts` already does in the other direction.
        permissions: ALL_PERMISSIONS as unknown as Prisma.InputJsonValue,
      },
    })

    // One row per non-owner staff preset (src/modules/staff/staff-presets.ts
    // — GENERAL/MANAGER/COUNTER/KITCHEN/DRIVER/SERVICE_PROVIDER/STOCK),
    // created together in a single round trip (see this transaction's
    // timeout comment below — still the same total number of round trips
    // this transaction makes, regardless of how many presets exist).
    // `inviteStaff` resolves `jobPreset` to pick the right one; GENERAL
    // stays `isDefault: true` as the fallback for anything that can't
    // resolve a preset.
    await tx.businessRole.createMany({
      data: Object.values(STAFF_PRESETS).map((preset) => ({
        businessId: business.id,
        name: preset.name,
        isDefault: preset.isDefault ?? false,
        presetRole: preset.presetRole,
        jobPreset: preset.id,
        permissions: preset.permissions as unknown as Prisma.InputJsonValue,
      })),
    })

    const owner = await tx.businessStaff.create({
      data: {
        businessId: business.id,
        roleId: ownerRole.id,
        email: validated.owner.email,
        // Never a usable credential: owners authenticate as AppUser at /login,
        // and /staff-login refuses owner rows. A random unknowable password
        // (as invited staff get before they set theirs) means even a
        // regression there couldn't turn this row into a way in.
        passwordHash: ownerStaffHash,
        firstName: validated.owner.firstName,
        lastName: validated.owner.lastName,
        phone: validated.owner.phone,
        staffRole: 'OWNER',
        isOwner: true,
      },
    })

    return { business, owner }
    },
    // Five sequential round trips (business, subscription, owner role, the
    // four non-owner presets in one createMany, staff)
    // against a real network hop — Prisma's default 5s transaction timeout
    // is tight even before accounting for Neon's serverless compute waking
    // from idle on the first query. Reproduced live: this transaction took
    // 8-17s against a freshly provisioned Neon database, well past the
    // default, causing P2028 ("transaction already closed") and silently
    // orphaning the AppUser row created just before this call in
    // /api/platform/join/route.ts (see that route's own note once fixed —
    // gap 15 in the tool-graduation record covers the orphan itself).
    // Raised to 30 s (Tab 5) after Billing saw "Transaction already closed"
    // under Neon latency at 15 s: a merchant must never see a failed
    // registration because the database was slow to wake.
    CREATE_BUSINESS_TX_OPTIONS,
  )
}

// ---------------------------------------------------------------------------
// Resolution (for the tenant-site middleware)
// ---------------------------------------------------------------------------

export async function getBusinessBySlug(slug: string) {
  return prisma.business.findFirst({
    where: { slug, status: 'ACTIVE' },
    include: {
      subscription: true,
      // The live primary custom domain, for canonical URLs (storefront-seo.ts).
      domains: { where: { surface: 'STOREFRONT', isPrimary: true, status: 'ACTIVE' }, select: { hostname: true }, take: 1 },
    },
  })
}

export async function getBusinessByCustomDomain(domain: string) {
  return prisma.business.findFirst({ where: { customDomain: domain, status: 'ACTIVE' }, include: { subscription: true } })
}

/**
 * Which storefront template a business has picked, for the new gated
 * /about, /gallery, /contact routes. No BusinessProfile row at all (created
 * before the onboarding interview existed, or the interview was skipped)
 * resolves the same way a missing/invalid id already does in
 * resolveStorefrontTemplate — null here, which that function's own fallback
 * treats as CLASSIC. Never throws.
 */
export async function getActiveTemplateId(businessId: string): Promise<string | null> {
  const profile = await prisma.businessProfile.findUnique({
    where: { businessId },
    select: { activeTemplateId: true },
  })
  return profile?.activeTemplateId ?? null
}

/**
 * Everything resolveStorefrontTemplate needs to resolve a GENERATED
 * business too, not just a static one — every storefront route (and the
 * Design Wizard's live state) should call this rather than
 * getActiveTemplateId alone, or a business's generated template would
 * exist in the database but never actually render.
 */
export async function getStorefrontTemplateSelection(
  businessId: string,
): Promise<{ activeTemplateId: string | null; generatedTemplate: unknown }> {
  const profile = await prisma.businessProfile.findUnique({
    where: { businessId },
    select: { activeTemplateId: true, generatedTemplate: true },
  })
  return { activeTemplateId: profile?.activeTemplateId ?? null, generatedTemplate: profile?.generatedTemplate ?? null }
}

/**
 * Saves the Design Wizard's template-picker choice. Upserts rather than
 * updates: a business whose BusinessProfile row doesn't exist yet (the
 * onboarding interview was skipped or never started — a real, valid state)
 * must still be able to pick a template, same as any other wizard step.
 * Throws on an unrecognised id — the wizard only ever offers real ids from
 * the registry, so this is a last-line-of-defence, not a UI-reachable path.
 */
export async function setActiveTemplateId(businessId: string, templateId: string): Promise<void> {
  if (!isValidTemplateId(templateId)) {
    throw new Error(`Invalid storefront template: ${templateId}`)
  }
  await prisma.businessProfile.upsert({
    where: { businessId },
    create: { businessId, activeTemplateId: templateId },
    update: { activeTemplateId: templateId },
  })
}

/**
 * Accepts a generated template: writes activeTemplateId=GENERATED and the
 * validated page list together, atomically — the two must never be saved
 * separately, or a business could briefly have GENERATED set with no (or
 * stale) generatedTemplate JSON behind it.
 */
export async function acceptGeneratedTemplate(
  businessId: string,
  pages: StorefrontPageId[],
  source: 'RULES' | 'MODEL',
): Promise<void> {
  await prisma.businessProfile.upsert({
    where: { businessId },
    create: {
      businessId,
      activeTemplateId: GENERATED_TEMPLATE_ID,
      generatedTemplate: { pages },
      generatedTemplateSource: source,
      generatedTemplateAt: new Date(),
    },
    update: {
      activeTemplateId: GENERATED_TEMPLATE_ID,
      generatedTemplate: { pages },
      generatedTemplateSource: source,
      generatedTemplateAt: new Date(),
    },
  })
}

// ---------------------------------------------------------------------------
// List (platform admin)
// ---------------------------------------------------------------------------

export async function listBusinesses(
  opts: {
    page?: number
    perPage?: number
    status?: BusinessStatus
    category?: BusinessCategory
    search?: string
  } = {},
) {
  const page = Math.max(1, opts.page ?? 1)
  const perPage = Math.min(100, opts.perPage ?? 25)

  const where = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.search
      ? {
          OR: [
            { name: { contains: opts.search, mode: 'insensitive' as const } },
            { city: { contains: opts.search, mode: 'insensitive' as const } },
            { slug: { contains: opts.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [businesses, total] = await Promise.all([
    prisma.business.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
      include: { subscription: true, _count: { select: { staff: true, memberships: true } } },
    }),
    prisma.business.count({ where }),
  ])

  return { businesses, total, page, perPage, totalPages: Math.ceil(total / perPage) }
}

// ---------------------------------------------------------------------------
// Search (public discovery — customer-facing, deliberately separate from
// listBusinesses above, which is the platform-admin view and exposes staff/
// membership counts that have no place on a public directory)
// ---------------------------------------------------------------------------

export interface DiscoverableBusiness {
  id: string
  slug: string
  name: string
  category: BusinessCategory
  description: string | null
  suburb: string | null
  city: string | null
  logoUrl: string | null
  primaryColor: string | null
  latitude: number | null
  longitude: number | null
  distanceKm?: number
}

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

/**
 * Active businesses for the public discovery page. Optional category filter
 * and optional geo-radius (requires both `near` and `radiusKm`).
 *
 * No PostGIS in this schema, and the expected row count for an early-stage
 * marketplace is small — distance is computed in application code after a
 * plain category/status filter, not as a database-level radius query. This
 * is the right tradeoff at today's scale; revisit if the active-business
 * count grows enough that pulling every row per request becomes real cost.
 */
export async function searchActiveBusinesses(opts: {
  category?: BusinessCategory
  near?: { lat: number; lng: number }
  radiusKm?: number
} = {}): Promise<DiscoverableBusiness[]> {
  const businesses = await prisma.business.findMany({
    where: {
      status: 'ACTIVE',
      ...(opts.category ? { category: opts.category } : {}),
    },
    select: {
      id: true, slug: true, name: true, category: true, description: true,
      suburb: true, city: true, logoUrl: true, primaryColor: true,
      latitude: true, longitude: true,
    },
    orderBy: { name: 'asc' },
  })

  if (!opts.near || !opts.radiusKm) return businesses

  const { lat, lng } = opts.near
  return businesses
    .filter((b) => b.latitude !== null && b.longitude !== null)
    .map((b) => ({ ...b, distanceKm: haversineKm(lat, lng, b.latitude!, b.longitude!) }))
    .filter((b) => b.distanceKm <= opts.radiusKm!)
    .sort((a, b) => a.distanceKm - b.distanceKm)
}

// ---------------------------------------------------------------------------
// Update / subscription / status
// ---------------------------------------------------------------------------

export async function updateBusiness(businessId: string, input: z.input<typeof UpdateBusinessSchema>) {
  // No customDomain here: a hostname must only ever route traffic after
  // verification (business_domains + domain.service.ts), never because it
  // was typed into a form.
  const parsed = UpdateBusinessSchema.safeParse(input)
  // The first problem, in words a merchant can act on — not a raw schema dump.
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Some details were not valid.')
  return prisma.business.update({ where: { id: businessId }, data: parsed.data })
}

export async function setBusinessStatus(businessId: string, status: BusinessStatus) {
  return prisma.business.update({ where: { id: businessId }, data: { status } })
}

// ---------------------------------------------------------------------------
// Publication — a business registers PENDING_VERIFICATION (invisible to
// customers) and stays that way until the owner deliberately publishes it.
// There is no email/admin-approval step in this codebase (checked — none
// exists), so the merchant is the one who decides "ready," not a queue.
// ---------------------------------------------------------------------------

/** Centralized status policy — one definition of "public," not one per call site. */
export function canBusinessBePublic(status: BusinessStatus): boolean {
  return status === 'ACTIVE'
}

export function canBusinessAcceptOrders(status: BusinessStatus): boolean {
  return status === 'ACTIVE'
}

export function canBusinessAcceptBookings(status: BusinessStatus): boolean {
  return status === 'ACTIVE'
}

export interface PublishReadiness {
  ready: boolean
  missing: string[]
}

/**
 * Whether a business has enough set up to be worth showing a customer.
 * Deliberately not name/category/contact — CreateBusinessSchema already
 * requires those at registration, so re-checking them here would be a
 * check that can never fail. The one real gap a brand-new business always
 * has is an empty catalog; a salon needs a service, a spaza needs a
 * product — either satisfies this, per business type isn't required.
 */
export async function getPublishReadiness(businessId: string): Promise<PublishReadiness> {
  const [productCount, serviceCount] = await Promise.all([
    prisma.product.count({ where: { businessId, isActive: true } }),
    prisma.service.count({ where: { businessId, isActive: true } }),
  ])

  const missing: string[] = []
  if (productCount === 0 && serviceCount === 0) {
    missing.push('Add at least one product or service')
  }

  return { ready: missing.length === 0, missing }
}

export class PublishValidationError extends Error {
  constructor(public readonly missing: string[]) {
    super('Business is not ready to publish: ' + missing.join(', '))
    this.name = 'PublishValidationError'
  }
}

/**
 * Transitions PENDING_VERIFICATION -> ACTIVE once minimum setup is met.
 * Idempotent: publishing an already-ACTIVE business is a no-op success,
 * not an error (the dashboard button firing twice shouldn't fail the
 * second time). SUSPENDED/DEACTIVATED cannot be re-published this way —
 * that's a platform-admin action (setBusinessStatus), a deliberately
 * different one from a merchant's own self-service publish.
 */
export async function publishBusiness(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { status: true },
  })
  if (!business) throw new Error('Business not found')
  if (business.status === 'ACTIVE') {
    return prisma.business.findUniqueOrThrow({ where: { id: businessId } })
  }
  if (business.status !== 'PENDING_VERIFICATION') {
    throw new Error(`A ${business.status.toLowerCase()} business can't be published this way — contact support.`)
  }

  const readiness = await getPublishReadiness(businessId)
  if (!readiness.ready) throw new PublishValidationError(readiness.missing)

  return prisma.business.update({ where: { id: businessId }, data: { status: 'ACTIVE' } })
}

/**
 * Business for the owner's own authenticated preview — deliberately NOT
 * status-filtered (that's the point: preview has to work before publish),
 * and deliberately takes only a session-derived businessId, never a
 * client-supplied slug — see src/app/dashboard/preview/page.tsx, the only
 * caller. Never use this for anything reachable by an unauthenticated
 * request.
 */
export async function getBusinessForPreview(businessId: string) {
  return prisma.business.findUnique({ where: { id: businessId }, include: { subscription: true } })
}
