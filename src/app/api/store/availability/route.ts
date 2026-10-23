import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { getActiveService } from '@/modules/catalog/catalog.service'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { getBusinessCapabilities } from '@/modules/tenant/capabilities'
import { windowForDate } from '@/modules/appointments/booking-rules'

export const runtime = 'nodejs'

/**
 * Read-only "which times are actually free" query for the storefront's
 * SlotPicker — replaces a raw <input type="datetime-local"> with real
 * availability, per DESIGN.md ("Only show times that can actually be
 * booked"). Reuses the exact same overlap-counting rule
 * createAppointment (appointment.service.ts) uses to accept/reject a
 * booking — this endpoint never reserves anything, so no advisory lock is
 * needed here, only at actual creation time.
 *
 * Tab 5: the window is the business's own opening hours for that day
 * (booking-rules.ts) — a closed day offers nothing, and a business whose
 * Bookings module is off offers nothing at all. DEFAULT_WINDOW remains only
 * for a business that has never set hours (fail-open, like orders).
 */
const DEFAULT_WINDOW = { startHour: 9, endHour: 17 }
const SLOT_STEP_MINUTES = 30

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const businessId = searchParams.get('businessId') ?? ''
  const serviceId = searchParams.get('serviceId') ?? ''
  const dateParam = searchParams.get('date') ?? ''

  if (!businessId || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: 'Missing or invalid businessId/serviceId/date' }, { status: 400 })
  }

  // A tenant hostname may only act on its own business (storefront-request.ts).
  const service = (await hostTenantConflict(req, businessId)) ? null : await getActiveService(businessId, serviceId)
  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { category: true, settings: true, operatingHours: true } })
  if (!business || !getBusinessCapabilities(business).has('BOOKINGS')) {
    return NextResponse.json({ slots: [], durationMinutes: service.duration ?? 60, bookable: false })
  }

  const duration = service.duration ?? 60
  const capacity = service.maxBookings ?? 1
  // A South African calendar day: the slot picker sends a date, not an instant.
  const dayStart = new Date(`${dateParam}T00:00:00+02:00`)
  if (Number.isNaN(dayStart.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  const window = windowForDate(business.operatingHours, dateParam)
  if (window.kind === 'closed') {
    return NextResponse.json({ slots: [], durationMinutes: duration, bookable: true, closed: true })
  }
  const openMinutes = window.kind === 'open' ? window.openMinutes : DEFAULT_WINDOW.startHour * 60
  const closeMinutes = window.kind === 'open' ? window.closeMinutes : DEFAULT_WINDOW.endHour * 60
  const windowStart = new Date(dayStart.getTime() + openMinutes * 60_000)
  const windowEnd = new Date(dayStart.getTime() + closeMinutes * 60_000)

  // One query for the whole day's existing bookings, then check each
  // candidate slot against it in memory — cheaper than one query per slot.
  const existing = await prisma.appointment.findMany({
    where: {
      businessId,
      serviceId,
      status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] },
      startTime: { lt: windowEnd },
      endTime: { gt: windowStart },
    },
    select: { startTime: true, endTime: true },
  })

  const now = new Date()
  const slots: { time: string; available: boolean }[] = []
  for (let t = new Date(windowStart); t < windowEnd; t = new Date(t.getTime() + SLOT_STEP_MINUTES * 60_000)) {
    const slotEnd = new Date(t.getTime() + duration * 60_000)
    if (slotEnd > windowEnd) break
    const overlapping = existing.filter((e) => e.startTime < slotEnd && e.endTime > t).length
    slots.push({
      time: t.toISOString(),
      available: t > now && overlapping < capacity,
    })
  }

  return NextResponse.json({ slots, durationMinutes: duration, bookable: true })
}
