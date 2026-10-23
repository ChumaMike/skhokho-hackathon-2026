/**
 * Appointment Service (service bookings)
 *
 * No appointment module existed before this — the `Appointment` model was
 * defined in the schema with a working service layer around everything else
 * (orders, inventory, customers) but nothing wrote to it. Mirrors
 * order.service's shape: businessId-scoped, membership link (never a raw
 * customer id), a `BusinessNotification` on create.
 */

import { z } from 'zod'
import { LEGAL_VERSION_PATTERN } from '@/lib/legal/documents'
import { prisma } from '@/lib/prisma/client'
import { assertBookable } from './booking-rules'

export const CreateAppointmentSchema = z.object({
  membershipId: z.string().uuid(),
  serviceId: z.string(),
  staffId: z.string().optional(),
  startTime: z.coerce.date(),
  notes: z.string().optional(),
  // Public booking form only — the platform Terms version the customer
  // accepted (already verified current by the route). Console bookings
  // never set it. See order.service.ts for the same field on orders.
  termsVersion: z.string().regex(LEGAL_VERSION_PATTERN).optional(),
})

export class AppointmentConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppointmentConflictError'
  }
}

export async function createAppointment(
  businessId: string,
  input: z.infer<typeof CreateAppointmentSchema>,
) {
  const validated = CreateAppointmentSchema.parse(input)

  const service = await prisma.service.findFirst({
    where: { id: validated.serviceId, businessId, isActive: true },
  })
  if (!service) throw new Error('Service not found')

  if (validated.startTime.getTime() < Date.now()) {
    throw new Error('Appointment time must be in the future')
  }

  const duration = service.duration ?? 60
  const endTime = new Date(validated.startTime.getTime() + duration * 60_000)

  // Tab 5 — the business must have Bookings switched on and be open for
  // the whole slot (booking-rules.ts). Checked here, at the service, so
  // neither storefront route nor any later caller can route around it.
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { category: true, settings: true, operatingHours: true },
  })
  assertBookable(business, validated.startTime, endTime)

  return prisma.$transaction(
    async (tx) => {
    // Service-capacity guard — the one that actually fires for every real
    // booking today: the storefront (src/app/api/store/book/route.ts) has
    // no staff-selection UI, so a staffId is never passed and the guard
    // below it never ran. `Service.maxBookings` already existed in the
    // schema for exactly this ("max simultaneous bookings for this
    // service") but nothing ever read it — default to 1 concurrent booking
    // when unset, matching this platform's target business (one owner, one
    // pair of hands: a spaza shop, a single-chair barber, a hair braider).
    //
    // A count-then-create has a real Read-Committed race: two concurrent
    // bookings for the same service can both count the same pre-booking
    // total, both pass the capacity check, and both insert — this can't be
    // expressed as a Postgres EXCLUDE constraint (that only guarantees "no
    // two rows overlap," not "no more than N rows overlap"), so instead an
    // advisory lock serializes the check+create for one business+service
    // at a time. Same pg_advisory_xact_lock pattern as
    // prisma/sql/10_identity_rpcs.sql's register_customer/redeem_reward, a
    // different salt (3) so the lock namespaces never collide.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${businessId} || ${validated.serviceId}, 3))`

    const capacity = service.maxBookings ?? 1
    const overlappingCount = await tx.appointment.count({
      where: {
        businessId,
        serviceId: validated.serviceId,
        status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] },
        startTime: { lt: endTime },
        endTime: { gt: validated.startTime },
      },
    })
    if (overlappingCount >= capacity) {
      throw new AppointmentConflictError(
        `That time is fully booked for ${service.name} — pick another time.`,
      )
    }

    // Real DB-level guarantee for the staff-specific case (the
    // appointments_staff_no_overlap EXCLUDE constraint, added alongside
    // this comment — see its migration for why it needs btree_gist).
    // This pre-check stays for a friendlier error message on the common
    // case; the constraint below is what's actually authoritative if two
    // requests for the same staff member race past this check together.
    if (validated.staffId) {
      const overlapping = await tx.appointment.findFirst({
        where: {
          businessId,
          staffId: validated.staffId,
          status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] },
          startTime: { lt: endTime },
          endTime: { gt: validated.startTime },
        },
      })
      if (overlapping) {
        throw new AppointmentConflictError('That staff member already has a booking in this slot')
      }
    }

    let appointment
    try {
      appointment = await tx.appointment.create({
        data: {
          businessId,
          membershipId: validated.membershipId,
          serviceId: validated.serviceId,
          staffId: validated.staffId,
          status: 'SCHEDULED',
          startTime: validated.startTime,
          endTime,
          duration,
          price: service.price,
          notes: validated.notes,
          termsVersion: validated.termsVersion,
          termsAcceptedAt: validated.termsVersion ? new Date() : undefined,
        },
      })
    } catch (e) {
      // Postgres exclusion_violation (23P01) — the race the pre-check
      // above can't fully close: two requests for the same staff member
      // both passed the findFirst check before either committed. The
      // EXCLUDE constraint is what actually catches this.
      if (e instanceof Error && 'code' in e && (e as { code?: unknown }).code === 'P2010') {
        const meta = (e as { meta?: { code?: unknown } }).meta
        if (meta?.code === '23P01') {
          throw new AppointmentConflictError('That staff member already has a booking in this slot')
        }
      }
      throw e
    }

    await tx.businessNotification.create({
      data: {
        businessId,
        type: 'new_appointment',
        title: 'New booking',
        message: `${service.name} booked for ${validated.startTime.toLocaleString('en-ZA')}`,
        data: { appointmentId: appointment.id, serviceId: service.id },
      },
    })

    return tx.appointment.findUnique({
      where: { id: appointment.id },
      include: {
        service: { select: { name: true, price: true, duration: true } },
        membership: { select: { publicId: true, shortCode: true, displayName: true } },
      },
    })
    },
    // Reproduced live: this transaction (capacity count, create, notification,
    // re-fetch — four round trips) exceeded Prisma's default 5s transaction
    // timeout against a real Neon database (5452ms observed), the same class
    // of bug as createBusiness's — see tenant.service.ts's comment on that
    // fix. The capacity-guard query added in Phase D made an already-tight
    // transaction tighter; fixed the same way rather than trimming queries.
    { timeout: 15_000, maxWait: 10_000 },
  )
}

/** Upcoming (not cancelled/completed) appointments, soonest first — the dashboard's view. */
export async function listUpcomingAppointments(businessId: string, opts: { limit?: number } = {}) {
  const limit = Math.min(200, opts.limit ?? 50)
  return prisma.appointment.findMany({
    where: {
      businessId,
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
      startTime: { gte: new Date() },
    },
    orderBy: { startTime: 'asc' },
    take: limit,
    include: {
      service: { select: { name: true } },
      membership: { select: { publicId: true, shortCode: true, displayName: true } },
    },
  })
}

/**
 * All appointments (any status) whose startTime falls within [from, to) —
 * the calendar view's query. Deliberately separate from
 * listUpcomingAppointments rather than adding optional range params to it:
 * that function's contract (SCHEDULED/CONFIRMED only, startTime >= now) is
 * relied on by the dashboard home/attention-count callers, and a calendar
 * showing a past week legitimately needs COMPLETED/CANCELLED/NO_SHOW rows
 * too.
 */
export async function listAppointmentsInRange(businessId: string, from: Date, to: Date) {
  return prisma.appointment.findMany({
    where: {
      businessId,
      startTime: { gte: from, lt: to },
    },
    orderBy: { startTime: 'asc' },
    include: {
      service: { select: { name: true, duration: true } },
      membership: { select: { publicId: true, shortCode: true, displayName: true } },
    },
  })
}

export async function getAppointment(businessId: string, appointmentId: string) {
  return prisma.appointment.findFirst({
    where: { id: appointmentId, businessId },
    include: {
      service: { select: { name: true, price: true, duration: true } },
      membership: { select: { publicId: true, shortCode: true, displayName: true } },
      staff: { select: { firstName: true, lastName: true } },
    },
  })
}

export async function confirmAppointment(businessId: string, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, businessId } })
  if (!appointment) throw new Error('Appointment not found')
  if (appointment.status !== 'SCHEDULED') {
    throw new Error(`Only a requested booking can be confirmed (this one is ${appointment.status.toLowerCase()})`)
  }
  return prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'CONFIRMED' } })
}

export async function completeAppointment(businessId: string, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, businessId } })
  if (!appointment) throw new Error('Appointment not found')
  if (['COMPLETED', 'CANCELLED'].includes(appointment.status)) {
    throw new Error(`Appointment is already ${appointment.status.toLowerCase()}`)
  }
  return prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'COMPLETED' } })
}

export async function cancelAppointment(businessId: string, appointmentId: string, reason?: string) {
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, businessId } })
  if (!appointment) throw new Error('Appointment not found')
  if (['COMPLETED', 'CANCELLED'].includes(appointment.status)) {
    throw new Error(`Cannot cancel an appointment with status: ${appointment.status}`)
  }

  return prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      status: 'CANCELLED',
      notes: reason ? `Cancelled: ${reason}` : appointment.notes,
    },
  })
}
