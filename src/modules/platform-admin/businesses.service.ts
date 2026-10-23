/**
 * Admin reads and commands for businesses. Every query is scoped by the one
 * business id asked for (no cross-tenant joins), returns counts/aggregates
 * rather than customer rows, and never exposes customers.id or membership ids.
 */

import type { BusinessStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { AdminCommandError } from './command'
import { loadMerchantReadiness } from './merchant-readiness'
import { orderAttentionCounts } from './order-attention'
import { getDeliverySettings, getFulfilmentSettings, getOrderingSettings, getPaymentSettings } from '@/modules/tenant/capabilities'
import { formatOperatingHours } from '@/modules/tenant/storefront-hours'
import { getBusinessEntitlements, listEntitlementOverrides } from '@/modules/billing/subscription.service'
import { getUsageSummary } from '@/modules/content/usage'

const DAY = 24 * 60 * 60 * 1000

export async function listBusinesses(opts: { q?: string; status?: BusinessStatus; take?: number }) {
  const where: Prisma.BusinessWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: 'insensitive' } }, { slug: { contains: opts.q.toLowerCase() } }] } : {}),
  }
  return prisma.business.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 50,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      category: true,
      createdAt: true,
      owner: { select: { email: true } },
      subscription: { select: { status: true, planRef: { select: { name: true } } } },
      _count: { select: { orders: true, staff: true } },
    },
  })
}

export async function businessDetail(businessId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY)
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      category: true,
      active: true,
      city: true,
      suburb: true,
      phone: true,
      whatsapp: true,
      latitude: true,
      longitude: true,
      logoUrl: true,
      bannerUrl: true,
      description: true,
      settings: true,
      operatingHours: true,
      createdAt: true,
      owner: { select: { id: true, email: true, isActive: true, lastLoginAt: true } },
      subscription: { select: { status: true, currentPeriodEnd: true, graceEndsAt: true, planRef: { select: { name: true, priceCents: true } } } },
      domains: { select: { hostname: true, status: true, surface: true, isPrimary: true, sslStatus: true } },
    },
  })
  if (!business) return null
  const scope = { businessId }
  const [staffRows, categories, productsActive, productsHidden, servicesActive, zones, connections, readinessMap, attention, entitlements, overrides, aiUsage, draftsByStatus, campaigns, plans, recentOrders, recentNetwork, recentInHouse, ordersAll, orders30, paid30, attempts30, refundDue, network30, networkIncidents, inHouse30, conversations, buddyActions30, revisions, events] = await Promise.all([
    // Staff: names and roles only — never emails, password or token material.
    prisma.businessStaff.findMany({
      where: scope,
      orderBy: [{ isOwner: 'desc' }, { firstName: 'asc' }],
      take: 50,
      select: { id: true, firstName: true, lastName: true, isOwner: true, isActive: true, lastLoginAt: true, jobTitle: true, resetToken: true, role: { select: { jobPreset: true, name: true } } },
    }),
    prisma.productCategory.count({ where: scope }),
    prisma.product.count({ where: { ...scope, isActive: true } }),
    prisma.product.count({ where: { ...scope, isActive: false } }),
    prisma.service.count({ where: { ...scope, isActive: true } }),
    prisma.deliveryZone.findMany({ where: scope, orderBy: [{ priority: 'asc' }, { name: 'asc' }], take: 50, select: { name: true, feeCents: true, minOrderCents: true, active: true, matchKind: true } }),
    prisma.businessPaymentConnection.findMany({
      where: { ...scope, retiredAt: null },
      orderBy: { createdAt: 'desc' },
      select: { environment: true, status: true, verifiedAt: true, lastError: true, updatedAt: true },
    }),
    loadMerchantReadiness([businessId], now),
    orderAttentionCounts(now, businessId),
    getBusinessEntitlements(businessId, now),
    listEntitlementOverrides(businessId),
    getUsageSummary(businessId, { now }),
    prisma.contentDraft.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    prisma.contentCampaign.count({ where: { ...scope, status: { not: 'ARCHIVED' } } }),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { code: true, name: true } }),
    prisma.order.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true, fulfilmentMethod: true, createdAt: true } }),
    prisma.networkDelivery.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, createdAt: true, orderId: true } }),
    prisma.orderDelivery.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, createdAt: true, orderId: true } }),
    prisma.order.count({ where: scope }),
    prisma.order.count({ where: { ...scope, createdAt: { gte: since } } }),
    prisma.order.aggregate({ where: { ...scope, createdAt: { gte: since }, paymentStatus: 'PAID' }, _sum: { total: true }, _count: { _all: true } }),
    prisma.businessPaymentAttempt.groupBy({ by: ['status'], where: { ...scope, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.businessPaymentAttempt.count({ where: { ...scope, status: 'REFUND_DUE' } }),
    prisma.networkDelivery.groupBy({ by: ['status'], where: { ...scope, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.networkDelivery.findMany({
      where: { ...scope, status: { in: ['FAILED', 'RETURNING', 'RETURNED', 'DISPUTED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, status: true, endReason: true, updatedAt: true },
    }),
    prisma.orderDelivery.count({ where: { ...scope, createdAt: { gte: since } } }),
    prisma.assistantConversation.count({ where: scope }),
    prisma.buddyAction.count({ where: { ...scope, createdAt: { gte: since } } }),
    prisma.storefrontRevision.count({ where: scope }),
    prisma.platformAuditEvent.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, category: true, action: true, outcome: true, actorType: true, reason: true, createdAt: true },
    }),
  ])
  const staff = staffRows.map((s) => ({
    id: s.id,
    name: `${s.firstName} ${s.lastName ? `${s.lastName[0]}.` : ''}`.trim(),
    role: s.isOwner ? 'Owner' : s.role?.jobPreset ?? s.role?.name ?? s.jobTitle ?? 'Staff',
    state: !s.isActive ? 'removed' : s.resetToken && !s.lastLoginAt ? 'invited' : 'active',
    lastLoginAt: s.lastLoginAt,
  }))
  const delivery = getDeliverySettings(business)
  const fulfilment = getFulfilmentSettings(business)
  const ordering = getOrderingSettings(business)
  const configuration = {
    hours: formatOperatingHours(business.operatingHours),
    pausedUntil: ordering.pausedUntil ? new Date(ordering.pausedUntil) : null,
    minOrderCents: ordering.minOrderCents,
    collection: fulfilment.collectionEnabled,
    delivery: delivery.enabled ? { mode: delivery.pricingMode, feeCents: delivery.feeCents, perKmFeeCents: delivery.perKmFeeCents, baseFeeCents: delivery.baseFeeCents, minFeeCents: delivery.minFeeCents, maxDistanceKm: delivery.maxDistanceKm, sources: fulfilment.deliverySources } : null,
    zones,
    onlinePaymentWanted: getPaymentSettings(business).online,
    connections,
    branding: { logo: Boolean(business.logoUrl), banner: Boolean(business.bannerUrl), description: Boolean(business.description), pinned: typeof business.latitude === 'number' && typeof business.longitude === 'number' },
  }
  return {
    business,
    readiness: readinessMap.get(businessId) ?? null,
    attention,
    plan: { entitlements, overrides, plans },
    content: { usage: aiUsage, drafts: Object.fromEntries(draftsByStatus.map((r) => [r.status, r._count._all])) as Record<string, number>, campaigns },
    configuration,
    staff,
    recent: { orders: recentOrders, networkDeliveries: recentNetwork, inHouseDeliveries: recentInHouse },
    counts: { staff: staff.filter((s) => s.state !== 'removed').length, categories, products: productsActive, productsHidden, services: servicesActive, ordersAll, orders30 },
    gmv30Cents: Math.round(Number(paid30._sum.total ?? 0) * 100),
    paidOrders30: paid30._count._all,
    payments30: Object.fromEntries(attempts30.map((r) => [r.status, r._count._all])),
    refundDue,
    networkDeliveries30: Object.fromEntries(network30.map((r) => [r.status, r._count._all])),
    networkIncidents,
    inHouseDeliveries30: inHouse30,
    ai: { conversations, buddyActions30, storefrontRevisions: revisions },
    events,
  }
}

const ALLOWED: Record<string, BusinessStatus[]> = {
  SUSPEND: ['ACTIVE', 'PENDING_VERIFICATION'],
  REACTIVATE: ['SUSPENDED'],
}

/** Suspend (storefront and console go offline — data kept) or reactivate. Conditional, so a race can't double-apply. */
export async function setBusinessStatus(businessId: string, command: 'SUSPEND' | 'REACTIVATE') {
  const from = ALLOWED[command]
  if (!from) throw new AdminCommandError('Unknown command.')
  const to: BusinessStatus = command === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE'
  const r = await prisma.business.updateMany({ where: { id: businessId, status: { in: from } }, data: { status: to } })
  if (r.count !== 1) throw new AdminCommandError(command === 'SUSPEND' ? 'Only an active or pending business can be suspended.' : 'Only a suspended business can be reactivated.')
  return to
}
