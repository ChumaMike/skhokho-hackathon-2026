/**
 * Review Service — trust signals for a marketplace where every customer is
 * a stranger to the business until they buy something. There is no login
 * to gate this behind (customers never authenticate — see the identity
 * core in prisma/schema.prisma), so eligibility is checked against the
 * order/appointment id itself: an unguessable cuid, the same trust model
 * already used for /store/pay/[orderId].
 *
 * A review always resolves to a Membership (never the global Customer),
 * matching every other customer-facing write in this app.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'

export const SubmitReviewSchema = z
  .object({
    orderId: z.string().optional(),
    appointmentId: z.string().optional(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(1000).optional(),
  })
  .refine((d) => (d.orderId ? 1 : 0) + (d.appointmentId ? 1 : 0) === 1, {
    message: 'A review must be tied to exactly one order or appointment',
  })

export class ReviewIneligibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewIneligibleError'
  }
}

/**
 * Is this order reviewable right now? COMPLETED, has a membership on it
 * (walk-in POS sales with no membershipId can't be attributed to anyone),
 * and doesn't already have a review. Looked up by id alone, same trust
 * model as /store/pay/[orderId] — the cuid itself is the access token,
 * there is no business-scoped session to check it against here.
 */
export async function getReviewableOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      businessId: true,
      status: true,
      membershipId: true,
      orderNumber: true,
      review: { select: { id: true } },
      business: { select: { name: true } },
      items: { select: { name: true, quantity: true } },
    },
  })
  if (!order) return { order: null, reason: 'not_found' as const }
  if (!order.membershipId) return { order, reason: 'no_membership' as const }
  if (order.status !== 'COMPLETED') return { order, reason: 'not_completed' as const }
  if (order.review) return { order, reason: 'already_reviewed' as const }
  return { order, reason: null }
}

export async function getReviewableAppointment(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      businessId: true,
      status: true,
      membershipId: true,
      review: { select: { id: true } },
      business: { select: { name: true } },
      service: { select: { name: true } },
    },
  })
  if (!appointment) return { appointment: null, reason: 'not_found' as const }
  if (!appointment.membershipId) return { appointment, reason: 'no_membership' as const }
  if (appointment.status !== 'COMPLETED') return { appointment, reason: 'not_completed' as const }
  if (appointment.review) return { appointment, reason: 'already_reviewed' as const }
  return { appointment, reason: null }
}

export async function submitReview(input: z.infer<typeof SubmitReviewSchema>) {
  const validated = SubmitReviewSchema.parse(input)

  if (validated.orderId) {
    const { order, reason } = await getReviewableOrder(validated.orderId)
    if (!order || reason) throw new ReviewIneligibleError(reasonMessage(reason))

    return prisma.$transaction(
      async (tx) => {
      const review = await tx.review.create({
        data: {
          businessId: order.businessId,
          membershipId: order.membershipId!,
          orderId: order.id,
          rating: validated.rating,
          comment: validated.comment,
        },
      })
      await tx.businessNotification.create({
        data: {
          businessId: order.businessId,
          type: 'new_review',
          title: `New ${validated.rating}★ review`,
          message: validated.comment || `A customer rated order ${order.orderNumber} ${validated.rating}/5`,
          data: { reviewId: review.id, orderId: order.id, rating: validated.rating },
        },
      })
      return review
      },
      // Same generous timeout applied to every $transaction in this pass
      // after finding the default 5s too tight against a real Neon
      // database (see tenant.service.ts's createBusiness) — this one is
      // only 2 queries and hasn't actually failed, but the margin is cheap.
      { timeout: 15_000, maxWait: 10_000 },
    )
  }

  const { appointment, reason } = await getReviewableAppointment(validated.appointmentId!)
  if (!appointment || reason) throw new ReviewIneligibleError(reasonMessage(reason))

  return prisma.$transaction(
    async (tx) => {
    const review = await tx.review.create({
      data: {
        businessId: appointment.businessId,
        membershipId: appointment.membershipId!,
        appointmentId: appointment.id,
        rating: validated.rating,
        comment: validated.comment,
      },
    })
    await tx.businessNotification.create({
      data: {
        businessId: appointment.businessId,
        type: 'new_review',
        title: `New ${validated.rating}★ review`,
        message:
          validated.comment ||
          `A customer rated ${appointment.service?.name ?? 'their booking'} ${validated.rating}/5`,
        data: { reviewId: review.id, appointmentId: appointment.id, rating: validated.rating },
      },
    })
    return review
    },
    { timeout: 15_000, maxWait: 10_000 },
  )
}

function reasonMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'not_found':
      return 'We could not find that order or booking.'
    case 'no_membership':
      return 'This one was rung up without a customer attached, so there is nothing to attribute a review to.'
    case 'not_completed':
      return 'This is not marked complete yet.'
    case 'already_reviewed':
      return 'A review has already been submitted for this.'
    default:
      return 'This cannot be reviewed right now.'
  }
}

// ---------------------------------------------------------------------------
// Public display — storefront / discover
// ---------------------------------------------------------------------------

export interface RatingSummary {
  average: number
  count: number
}

/** Rating summary for one business, for a storefront header. */
export async function getRatingSummary(businessId: string): Promise<RatingSummary> {
  const agg = await prisma.review.aggregate({
    where: { businessId, isPublished: true },
    _avg: { rating: true },
    _count: true,
  })
  return { average: agg._avg.rating ?? 0, count: agg._count }
}

/**
 * Rating summaries for many businesses at once — the /discover results
 * list, so this is one grouped query rather than one per card.
 */
export async function getRatingSummaries(
  businessIds: string[],
): Promise<Record<string, RatingSummary>> {
  if (businessIds.length === 0) return {}
  const rows = await prisma.review.groupBy({
    by: ['businessId'],
    where: { businessId: { in: businessIds }, isPublished: true },
    _avg: { rating: true },
    _count: true,
  })
  return Object.fromEntries(
    rows.map((r) => [r.businessId, { average: r._avg.rating ?? 0, count: r._count }]),
  )
}

/** Published reviews for a storefront's reviews section, newest first. */
export async function listPublishedReviews(businessId: string, opts: { limit?: number } = {}) {
  const limit = Math.min(50, opts.limit ?? 20)
  return prisma.review.findMany({
    where: { businessId, isPublished: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      rating: true,
      comment: true,
      createdAt: true,
      membership: { select: { displayName: true, shortCode: true } },
    },
  })
}

// ---------------------------------------------------------------------------
// Owner-facing — "share this link" prompts on the orders/appointments
// dashboards once something is marked complete.
// ---------------------------------------------------------------------------

/** Recently completed orders with no review yet, most recent first. */
export async function listUnreviewedCompletedOrders(businessId: string, opts: { limit?: number } = {}) {
  const limit = Math.min(50, opts.limit ?? 10)
  return prisma.order.findMany({
    where: { businessId, status: 'COMPLETED', membershipId: { not: null }, review: null },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, orderNumber: true, updatedAt: true },
  })
}

/** Recently completed appointments with no review yet, most recent first. */
export async function listUnreviewedCompletedAppointments(
  businessId: string,
  opts: { limit?: number } = {},
) {
  const limit = Math.min(50, opts.limit ?? 10)
  return prisma.appointment.findMany({
    where: { businessId, status: 'COMPLETED', membershipId: { not: null }, review: null },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, updatedAt: true, service: { select: { name: true } } },
  })
}
