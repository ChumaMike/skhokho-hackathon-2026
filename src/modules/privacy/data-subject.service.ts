/**
 * Data-subject requests (Tab 5): export and erasure, for one customer at a
 * business and for a business as a whole. Admin-side, keyed by phone for
 * customers (the merchant's customer self-service button waits for
 * Customer accounts). Every request is recorded in data_subject_requests.
 *
 * Identity core (customers, identifiers, memberships, consents, visits) is
 * written ONLY through the erase_membership RPC (migration
 * 20261022120400): the membership is revoked and de-named, consents at the
 * business revoked, and — when no other business still has a live
 * relationship with the person — their identifiers deleted and the
 * customer row de-identified. Visits are append-only by trigger and hold no
 * personal information; they remain as counts. The global customer id never
 * leaves SQL: every read here joins through the pairwise membership.
 *
 * Erasure is de-identification, not deletion: payment attempts/events,
 * domain registrations and network deliveries are financial / contractual
 * history under ON DELETE RESTRICT. They are kept with their personal
 * fields scrubbed, and the business row itself stays (DEACTIVATED) so every
 * reference still resolves.
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { normalisePhone, isValidZaMobile } from '@/lib/za-phone'
import { removeDomain } from '@/modules/domains/domain.service'

export class DataSubjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataSubjectError'
  }
}

export interface RequestActor {
  type: 'platform_admin' | 'staff'
  id: string
}

const MIN_REASON = 5
const ERASED = '[erased]'

/** Keyed hash of the normalised phone a request was keyed by — enough to find the record again, never the number itself. */
export function phoneHash(e164: string): string {
  return createHash('sha256').update(`dsr-phone:${process.env.JWT_SECRET ?? ''}:${e164}`).digest('hex').slice(0, 40)
}

function requireReason(reason: string | null | undefined): string {
  const trimmed = (reason ?? '').trim()
  if (trimmed.length < MIN_REASON) throw new DataSubjectError(`Give a reason (at least ${MIN_REASON} characters) — it goes on the record.`)
  return trimmed.slice(0, 500)
}

function requireMobile(phone: string): string {
  const e164 = normalisePhone(phone)
  if (!isValidZaMobile(e164)) throw new DataSubjectError('That is not a valid SA mobile number.')
  return e164
}

async function record(input: {
  businessId: string
  kind: 'EXPORT' | 'ERASE'
  subject: 'BUSINESS' | 'CUSTOMER'
  membershipPublicId?: string | null
  phoneHash?: string | null
  actor: RequestActor
  reason?: string | null
  summary?: Record<string, unknown>
}) {
  await prisma.dataSubjectRequest.create({
    data: {
      businessId: input.businessId,
      kind: input.kind,
      subject: input.subject,
      membershipPublicId: input.membershipPublicId ?? null,
      phoneHash: input.phoneHash ?? null,
      actorType: input.actor.type,
      actorId: input.actor.id,
      reason: input.reason ?? null,
      summary: (input.summary ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })
}

// ---------------------------------------------------------------------------
// Lookup by phone — the admin's entry point
// ---------------------------------------------------------------------------

export interface MembershipByPhone {
  businessId: string
  businessName: string
  businessSlug: string
  publicId: string
  shortCode: string
  displayName: string | null
  status: string
  firstSeen: Date
  lastSeen: Date
}

/** Every business relationship held by the person with this phone — pairwise ids only. */
export async function findMembershipsByPhone(phone: string): Promise<{ phone: string; memberships: MembershipByPhone[] }> {
  const e164 = requireMobile(phone)
  const rows = await prisma.$queryRaw<
    { business_id: string; business_name: string; business_slug: string; public_id: string; short_code: string; display_name: string | null; status: string; first_seen: Date; last_seen: Date }[]
  >`
    SELECT m.business_id, b.name AS business_name, b.slug AS business_slug, m.public_id, m.short_code, m.display_name, m.status, m.first_seen, m.last_seen
    FROM customer_identifiers ci
    JOIN memberships m ON m.customer_id = ci.customer_id
    JOIN businesses b ON b.id = m.business_id
    WHERE ci.type = 'phone' AND ci.value = ${e164}
    ORDER BY b.name, m.first_seen`
  return {
    phone: e164,
    memberships: rows.map((r) => ({
      businessId: r.business_id,
      businessName: r.business_name,
      businessSlug: r.business_slug,
      publicId: r.public_id,
      shortCode: r.short_code,
      displayName: r.display_name,
      status: r.status,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
    })),
  }
}

// ---------------------------------------------------------------------------
// Customer export
// ---------------------------------------------------------------------------

const ORDER_EXPORT_SELECT = {
  orderNumber: true,
  status: true,
  source: true,
  subtotal: true,
  discount: true,
  deliveryFee: true,
  total: true,
  paymentMethod: true,
  paymentStatus: true,
  paidAt: true,
  notes: true,
  metadata: true,
  createdAt: true,
  items: { select: { name: true, quantity: true, unitPrice: true, total: true, options: { select: { groupNameSnapshot: true, optionNameSnapshot: true, priceDeltaSnapshot: true } } } },
  delivery: { select: { status: true, deliveryAddressSnapshot: true, deliveryInstructions: true, contactPhone: true, deliveredAt: true, failureReason: true } },
} satisfies Prisma.OrderSelect

function money(v: Prisma.Decimal | null | undefined): string | null {
  return v == null ? null : Number(v).toFixed(2)
}

function exportOrder(o: Prisma.OrderGetPayload<{ select: typeof ORDER_EXPORT_SELECT }>) {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    source: o.source,
    subtotal: money(o.subtotal),
    discount: money(o.discount),
    deliveryFee: money(o.deliveryFee),
    total: money(o.total),
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    paidAt: o.paidAt,
    notes: o.notes,
    notifyEmail: (o.metadata as { notifyEmail?: unknown } | null)?.notifyEmail ?? null,
    placedAt: o.createdAt,
    items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: money(i.unitPrice), total: money(i.total), options: i.options.map((op) => `${op.groupNameSnapshot}: ${op.optionNameSnapshot}`) })),
    delivery: o.delivery,
  }
}

export async function exportCustomerData(businessId: string, publicId: string, actor: RequestActor, keyedByPhone?: string) {
  const membership = await prisma.membership.findFirst({
    where: { businessId, publicId },
    select: { id: true, publicId: true, shortCode: true, displayName: true, firstSeen: true, lastSeen: true, status: true, business: { select: { id: true, name: true } } },
  })
  if (!membership) return null

  const [identifiers, consents, visits, orders, appointments, reviews] = await Promise.all([
    prisma.$queryRaw<{ type: string; value: string; verified_at: Date | null; source: string }[]>`
      SELECT ci.type, ci.value, ci.verified_at, ci.source
      FROM customer_identifiers ci JOIN memberships m ON m.customer_id = ci.customer_id
      WHERE m.public_id = ${publicId}::uuid AND m.business_id = ${businessId}::uuid
      ORDER BY ci.created_at`,
    prisma.$queryRaw<{ purpose: string; channel: string | null; granted_at: Date; revoked_at: Date | null; source: string }[]>`
      SELECT c.purpose, c.channel, c.granted_at, c.revoked_at, c.source
      FROM consents c JOIN memberships m ON m.customer_id = c.customer_id
      WHERE m.public_id = ${publicId}::uuid AND m.business_id = ${businessId}::uuid
        AND (c.business_id = ${businessId}::uuid OR c.business_id IS NULL)
      ORDER BY c.granted_at`,
    prisma.visit.findMany({ where: { membershipId: membership.id, businessId }, select: { kind: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    prisma.order.findMany({ where: { membershipId: membership.id, businessId }, select: ORDER_EXPORT_SELECT, orderBy: { createdAt: 'asc' } }),
    prisma.appointment.findMany({
      where: { membershipId: membership.id, businessId },
      select: { startTime: true, endTime: true, status: true, notes: true, price: true, service: { select: { name: true } } },
      orderBy: { startTime: 'asc' },
    }),
    prisma.review.findMany({ where: { membershipId: membership.id, businessId }, select: { rating: true, comment: true, isPublished: true, createdAt: true } }),
  ])

  const data = {
    exportedAt: new Date().toISOString(),
    business: membership.business,
    membership: { publicId: membership.publicId, shortCode: membership.shortCode, displayName: membership.displayName, firstSeen: membership.firstSeen, lastSeen: membership.lastSeen, status: membership.status },
    identifiers: identifiers.map((i) => ({ type: i.type, value: i.value, verifiedAt: i.verified_at, source: i.source })),
    consents: consents.map((c) => ({ purpose: c.purpose, channel: c.channel, grantedAt: c.granted_at, revokedAt: c.revoked_at, source: c.source })),
    visits,
    orders: orders.map(exportOrder),
    appointments: appointments.map((a) => ({ service: a.service?.name ?? null, startTime: a.startTime, endTime: a.endTime, status: a.status, price: money(a.price), notes: a.notes })),
    reviews,
  }
  await record({ businessId, kind: 'EXPORT', subject: 'CUSTOMER', membershipPublicId: publicId, phoneHash: keyedByPhone ? phoneHash(requireMobile(keyedByPhone)) : null, actor })
  return data
}

// ---------------------------------------------------------------------------
// Customer erasure
// ---------------------------------------------------------------------------

interface RpcResult {
  membership_id: string
  identifiers_removed: number
  consents_revoked: number
  customer_fully_erased: boolean
  other_live_memberships: number
}

/** Scrubs the personal fields on everything that hangs off memberships at a business (or one of them). Runs in the caller's transaction. */
async function scrubRecords(tx: Prisma.TransactionClient, businessId: string, membershipId?: string) {
  const orderWhere: Prisma.OrderWhereInput = membershipId ? { businessId, membershipId } : { businessId }
  const orders = await tx.order.findMany({ where: orderWhere, select: { id: true, metadata: true } })
  for (const o of orders) {
    const meta = { ...((o.metadata ?? {}) as Record<string, unknown>) }
    delete meta.notifyEmail
    await tx.order.update({ where: { id: o.id }, data: { notes: null, metadata: meta as Prisma.InputJsonValue } })
  }
  const deliveries = await tx.orderDelivery.updateMany({
    where: { businessId, order: orderWhere },
    data: { deliveryAddressSnapshot: ERASED, deliveryInstructions: null, contactPhone: null, deliveryLat: null, deliveryLng: null, driverLat: null, driverLng: null, driverLocationUpdatedAt: null },
  })
  const appointments = await tx.appointment.updateMany({ where: membershipId ? { businessId, membershipId } : { businessId }, data: { notes: null } })
  const reviews = await tx.review.updateMany({ where: membershipId ? { businessId, membershipId } : { businessId }, data: { comment: null, isPublished: false } })
  return { orders: orders.length, deliveries: deliveries.count, appointments: appointments.count, reviews: reviews.count }
}

async function eraseMembershipCore(businessId: string, publicId: string, actor: RequestActor, reason: string) {
  const membership = await prisma.membership.findFirst({ where: { businessId, publicId }, select: { id: true } })
  if (!membership) throw new DataSubjectError('That customer was not found at this business.')
  const rows = await prisma.$queryRaw<{ result: RpcResult }[]>`
    SELECT erase_membership(${businessId}::uuid, ${publicId}::uuid, ${actor.type}, ${actor.id}, ${reason}) AS result`
  const rpc = rows[0].result
  const scrubbed = await prisma.$transaction((tx) => scrubRecords(tx, businessId, membership.id), { timeout: 30_000, maxWait: 10_000 })
  return { ...rpc, ...scrubbed }
}

export async function eraseCustomer(businessId: string, publicId: string, actor: RequestActor, reasonInput: string, keyedByPhone?: string) {
  const reason = requireReason(reasonInput)
  const summary = await eraseMembershipCore(businessId, publicId, actor, reason)
  await record({ businessId, kind: 'ERASE', subject: 'CUSTOMER', membershipPublicId: publicId, phoneHash: keyedByPhone ? phoneHash(requireMobile(keyedByPhone)) : null, actor, reason, summary })
  return summary
}

// ---------------------------------------------------------------------------
// Business export
// ---------------------------------------------------------------------------

export async function exportBusinessData(businessId: string, actor: RequestActor) {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true, name: true, slug: true, description: true, category: true, status: true,
      email: true, phone: true, whatsapp: true, address: true, suburb: true, city: true, province: true, postalCode: true,
      logoUrl: true, bannerUrl: true, primaryColor: true, accentColor: true, settings: true, operatingHours: true, config: true, createdAt: true,
      owner: { select: { email: true, createdAt: true, lastLoginAt: true } },
      subscription: { select: { status: true, currentPeriodEnd: true, planRef: { select: { code: true, name: true } } } },
      staff: { select: { firstName: true, lastName: true, email: true, phone: true, jobTitle: true, staffRole: true, isOwner: true, isActive: true, createdAt: true, lastLoginAt: true, role: { select: { name: true } } } },
      roles: { select: { name: true, permissions: true } },
      productCategories: { select: { name: true, isActive: true } },
      products: { select: { name: true, description: true, price: true, isActive: true, isFeatured: true, sortOrder: true, soldOutUntil: true, category: { select: { name: true } } } },
      services: { select: { name: true, description: true, price: true, duration: true, isActive: true } },
      domains: { select: { hostname: true, surface: true, status: true, isPrimary: true, createdAt: true } },
      domainRegistrations: { select: { domain: true, status: true, registrantName: true, registrantEmail: true, years: true, priceCents: true, expiresAt: true, registeredAt: true } },
      paymentConnections: { select: { environment: true, merchantId: true, status: true, verifiedAt: true, retiredAt: true } },
      paymentAttempts: { select: { reference: true, purpose: true, environment: true, expectedAmount: true, status: true, providerPaymentId: true, createdAt: true, verifiedAt: true } },
      notifications: { select: { type: true, title: true, message: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      assistantConversations: { select: { staffId: true, messages: { select: { role: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' } } } },
      contentDrafts: { select: { title: true, content: true, type: true, channel: true, status: true, createdAt: true } },
      emailChange: { select: { verifiedEmail: true, verifiedAt: true, pendingEmail: true } },
    },
  })
  if (!b) return null

  const [memberships, orders, appointments, reviews] = await Promise.all([
    prisma.$queryRaw<{ public_id: string; short_code: string; display_name: string | null; first_seen: Date; last_seen: Date; status: string; stamps: bigint; redeems: bigint }[]>`
      SELECT m.public_id, m.short_code, m.display_name, m.first_seen, m.last_seen, m.status,
             (SELECT count(*) FROM visits v WHERE v.membership_id = m.id AND v.kind = 'stamp') AS stamps,
             (SELECT count(*) FROM visits v WHERE v.membership_id = m.id AND v.kind = 'redeem') AS redeems
      FROM memberships m WHERE m.business_id = ${businessId}::uuid ORDER BY m.first_seen`,
    prisma.order.findMany({ where: { businessId }, select: { ...ORDER_EXPORT_SELECT, membership: { select: { publicId: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.appointment.findMany({ where: { businessId }, select: { startTime: true, endTime: true, status: true, notes: true, price: true, service: { select: { name: true } }, membership: { select: { publicId: true } } }, orderBy: { startTime: 'asc' } }),
    prisma.review.findMany({ where: { businessId }, select: { rating: true, comment: true, isPublished: true, createdAt: true, membership: { select: { publicId: true } } } }),
  ])

  const data = {
    exportedAt: new Date().toISOString(),
    business: {
      id: b.id, name: b.name, slug: b.slug, description: b.description, category: b.category, status: b.status, createdAt: b.createdAt,
      contact: { email: b.email, phone: b.phone, whatsapp: b.whatsapp, address: b.address, suburb: b.suburb, city: b.city, province: b.province, postalCode: b.postalCode },
      branding: { logoUrl: b.logoUrl, bannerUrl: b.bannerUrl, primaryColor: b.primaryColor, accentColor: b.accentColor },
      settings: b.settings, operatingHours: b.operatingHours, config: b.config, emailChange: b.emailChange,
    },
    owner: b.owner,
    subscription: b.subscription ? { plan: b.subscription.planRef?.code ?? null, planName: b.subscription.planRef?.name ?? null, status: b.subscription.status, currentPeriodEnd: b.subscription.currentPeriodEnd } : null,
    staff: b.staff.map((s) => ({ ...s, role: s.role?.name ?? null })),
    roles: b.roles,
    catalogue: { categories: b.productCategories, products: b.products.map((p) => ({ ...p, price: money(p.price), category: p.category?.name ?? null })), services: b.services.map((s) => ({ ...s, price: money(s.price) })) },
    customers: memberships.map((m) => ({ publicId: m.public_id, shortCode: m.short_code, displayName: m.display_name, firstSeen: m.first_seen, lastSeen: m.last_seen, status: m.status, stamps: Number(m.stamps), redeems: Number(m.redeems) })),
    orders: orders.map((o) => ({ ...exportOrder(o), customer: o.membership?.publicId ?? null })),
    appointments: appointments.map((a) => ({ service: a.service?.name ?? null, customer: a.membership?.publicId ?? null, startTime: a.startTime, endTime: a.endTime, status: a.status, price: money(a.price), notes: a.notes })),
    reviews: reviews.map((r) => ({ ...r, customer: r.membership.publicId })),
    domains: b.domains,
    domainRegistrations: b.domainRegistrations,
    payments: {
      connections: b.paymentConnections.map((c) => ({ ...c, merchantId: `…${c.merchantId.slice(-4)}` })),
      attempts: b.paymentAttempts.map((a) => ({ ...a, expectedAmount: money(a.expectedAmount) })),
    },
    notifications: b.notifications,
    assistantConversations: b.assistantConversations,
    contentDrafts: b.contentDrafts,
  }
  await record({ businessId, kind: 'EXPORT', subject: 'BUSINESS', actor })
  return data
}

// ---------------------------------------------------------------------------
// Business erasure
// ---------------------------------------------------------------------------

export const ERASABLE_BUSINESS_STATUSES = ['SUSPENDED', 'DEACTIVATED'] as const

/**
 * De-identifies a business and everything personal under it. Only for a
 * business that is already SUSPENDED or DEACTIVATED — erasure is the last
 * step of closing an account, never a way to close one. Each step is its own
 * write, so a failure midway can be re-run: every step is idempotent.
 */
export async function eraseBusinessData(businessId: string, actor: RequestActor, reasonInput: string) {
  const reason = requireReason(reasonInput)
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, status: true, ownerUserId: true } })
  if (!business) throw new DataSubjectError('Business not found.')
  if (!(ERASABLE_BUSINESS_STATUSES as readonly string[]).includes(business.status)) {
    throw new DataSubjectError('Suspend or deactivate the business first — erasure is the last step of closing it, not a way to close it.')
  }
  const now = new Date()
  const summary: Record<string, number | boolean> = {}

  // 1. Domains: stop routing and detach; registrations keep the contract, lose the person.
  const domains = await prisma.businessDomain.findMany({ where: { businessId, status: { not: 'REVOKED' } }, select: { id: true } })
  for (const d of domains) await removeDomain(businessId, d.id)
  summary.domainsRemoved = domains.length
  summary.registrationsScrubbed = (await prisma.domainRegistration.updateMany({ where: { businessId }, data: { registrantName: ERASED, registrantEmail: 'erased@invalid' } })).count

  // 2. Customers: every live membership through the identity RPC.
  const memberships = await prisma.membership.findMany({ where: { businessId, status: 'active' }, select: { publicId: true } })
  let fullyErased = 0
  for (const m of memberships) {
    const r = await prisma.$queryRaw<{ result: RpcResult }[]>`
      SELECT erase_membership(${businessId}::uuid, ${m.publicId}::uuid, ${actor.type}, ${actor.id}, ${reason}) AS result`
    if (r[0].result.customer_fully_erased) fullyErased += 1
  }
  summary.membershipsErased = memberships.length
  summary.customersFullyErased = fullyErased

  // 3. Orders, deliveries, appointments, reviews — the whole business, with or without a customer link.
  Object.assign(summary, await prisma.$transaction((tx) => scrubRecords(tx, businessId), { timeout: 60_000, maxWait: 10_000 }))

  // 4. Staff accounts and sessions.
  const staff = await prisma.businessStaff.findMany({ where: { businessId }, select: { id: true } })
  for (const s of staff) {
    await prisma.businessStaff.update({
      where: { id: s.id },
      data: { email: `erased+${s.id}@erased.invalid`, firstName: 'Erased', lastName: 'Staff', phone: null, avatarUrl: null, passwordHash: 'erased', resetToken: null, resetTokenExpiry: null, isActive: false, jobTitle: null },
    })
  }
  await prisma.businessStaffSession.deleteMany({ where: { staff: { businessId } } })
  summary.staffScrubbed = staff.length

  // 5. The owner's sign-in, when this was their only business and the account does nothing else.
  if (business.ownerUserId) {
    const owner = await prisma.appUser.findUnique({
      where: { id: business.ownerUserId },
      select: { id: true, role: true, _count: { select: { ownedBusinesses: true } }, driverProfile: { select: { id: true } }, platformAdmin: { select: { id: true } } },
    })
    const soleUse = owner && owner.role === 'OWNER' && owner._count.ownedBusinesses === 1 && !owner.driverProfile && !owner.platformAdmin
    if (owner && soleUse) {
      await prisma.appUser.update({ where: { id: owner.id }, data: { email: `erased+${owner.id}@erased.invalid`, passwordHash: null, resetToken: null, resetTokenExpiry: null, emailVerifiedAt: null, isActive: false } })
    }
    summary.ownerAccountErased = Boolean(owner && soleUse)
  }

  // 6. Everything that is purely the business's own working data.
  summary.notificationsDeleted = (await prisma.businessNotification.deleteMany({ where: { businessId } })).count
  summary.conversationsDeleted = (await prisma.assistantConversation.deleteMany({ where: { businessId } })).count
  summary.buddyActionsDeleted = (await prisma.buddyAction.deleteMany({ where: { businessId } })).count
  summary.contentDraftsDeleted = (await prisma.contentDraft.deleteMany({ where: { businessId } })).count
  summary.contentCampaignsDeleted = (await prisma.contentCampaign.deleteMany({ where: { businessId } })).count
  summary.storefrontRevisionsDeleted = (await prisma.storefrontRevision.deleteMany({ where: { businessId } })).count
  await prisma.businessProfile.deleteMany({ where: { businessId } })
  await prisma.businessEmailChange.deleteMany({ where: { businessId } })

  // 7. Payment credentials: sealed secrets destroyed; the reconciliation rows stay.
  summary.paymentConnectionsRetired = (
    await prisma.businessPaymentConnection.updateMany({
      where: { businessId },
      data: { status: 'DISABLED', retiredAt: now, merchantKeyCipher: 'erased', passphraseCipher: null },
    })
  ).count

  // 8. The business row: de-identified, DEACTIVATED, keeps its id, name and slug so history still resolves.
  await prisma.business.update({
    where: { id: businessId },
    data: {
      status: 'DEACTIVATED', active: false, previewToken: null, description: null,
      email: null, phone: null, whatsapp: null, address: null, suburb: null, city: null, province: null, postalCode: null, latitude: null, longitude: null,
      logoUrl: null, bannerUrl: null, config: Prisma.DbNull, settings: Prisma.DbNull, operatingHours: Prisma.DbNull, customDomain: null,
    },
  })

  await record({ businessId, kind: 'ERASE', subject: 'BUSINESS', actor, reason, summary })
  return summary
}

export async function listDataSubjectRequests(businessId: string, take = 50) {
  return prisma.dataSubjectRequest.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' }, take })
}
