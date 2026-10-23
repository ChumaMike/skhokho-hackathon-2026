/**
 * The canonical shape of `Business.operatingHours` and the ONE validated
 * write path for it. Reads stay defensive (storefront-hours.ts); writes are
 * strict: HH:MM only, close ≠ open, a closed day carries no times.
 * Overnight windows (close earlier than open, e.g. 18:00–02:00) are allowed —
 * isBusinessOpenNow already understands them.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'

export const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]
export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const DaySchema = z
  .union([
    z.object({ closed: z.literal(true) }).strict(),
    z
      .object({ open: z.string().regex(TIME, 'Use HH:MM, e.g. 09:00'), close: z.string().regex(TIME, 'Use HH:MM, e.g. 20:00'), closed: z.literal(false).optional() })
      .strict()
      .refine((d) => d.open !== d.close, { message: 'Opening and closing time cannot be the same.' }),
  ])

export const OperatingHoursSchema = z.object(Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, DaySchema])) as Record<WeekdayKey, typeof DaySchema>).strict()
export type OperatingHours = z.infer<typeof OperatingHoursSchema>
export type DayHours = z.infer<typeof DaySchema>

/** Monday–Saturday 09:00–17:00, Sunday closed — a sensible starting point for a form, never written without the merchant saving it. */
export function defaultOperatingHours(): OperatingHours {
  return Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, k === 'sunday' ? { closed: true } : { open: '09:00', close: '17:00' }])) as OperatingHours
}

/** Whatever is stored (possibly legacy/partial), shaped for the editor: unknown days become "closed". */
export function hoursForEditor(raw: unknown): OperatingHours {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = {} as Record<WeekdayKey, DayHours>
  for (const key of WEEKDAY_KEYS) {
    const entry = data[key] as { open?: unknown; close?: unknown; closed?: unknown } | undefined
    if (entry && typeof entry === 'object' && entry.closed !== true && typeof entry.open === 'string' && typeof entry.close === 'string' && TIME.test(entry.open) && TIME.test(entry.close)) {
      out[key] = { open: entry.open, close: entry.close }
    } else {
      out[key] = { closed: true }
    }
  }
  return out
}

export function hasConfiguredHours(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && Object.keys(raw as object).length > 0)
}

/** Form fields `<day>-closed`, `<day>-open`, `<day>-close` → validated hours. Throws a plain-English error. */
export function parseHoursForm(fd: FormData): OperatingHours {
  const candidate: Record<string, unknown> = {}
  for (const key of WEEKDAY_KEYS) {
    if (fd.get(`${key}-closed`) === 'on') candidate[key] = { closed: true }
    else candidate[key] = { open: String(fd.get(`${key}-open`) ?? '').trim(), close: String(fd.get(`${key}-close`) ?? '').trim() }
  }
  const parsed = OperatingHoursSchema.safeParse(candidate)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const day = issue?.path[0] ? WEEKDAY_LABELS[issue.path[0] as WeekdayKey] : 'A day'
    throw new Error(`${day}: ${issue?.message ?? 'check the times'}`)
  }
  return parsed.data
}

/** The only writer of Business.operatingHours. Tenant-scoped by the id the caller's session carries. */
export async function setOperatingHours(businessId: string, hours: OperatingHours): Promise<void> {
  const validated = OperatingHoursSchema.parse(hours)
  await prisma.business.update({ where: { id: businessId }, data: { operatingHours: validated } })
}
