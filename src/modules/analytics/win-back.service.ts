/**
 * Win-back list — the database side.
 *
 * Reads only, one business at a time, through `memberships`: the pairwise view
 * a business is allowed. The query selects `public_id`, the short code and the
 * display name — never `customers.id`, and never an identifier that would let
 * two businesses recognise the same person.
 *
 * Contact numbers are a separate decision, not a side effect of being on this
 * list. The only number a business may see is one the customer typed into a
 * delivery order themselves (`order_deliveries.contact_phone`, guarded on the
 * Orders page by canManageOrders / canManageDeliveries), so the caller has to
 * say whether this person may see those; without it the list still works and
 * simply has no WhatsApp links.
 */

import { prisma } from '@/lib/prisma/client'
import { buildWinBackList, type CustomerOrderHistory, type WinBackList } from './win-back'

interface WinBackRow {
  public_id: string
  short_code: string
  display_name: string | null
  cents: bigint
  order_dates: Date[]
  contact_phone: string | null
}

export async function getWinBackList(
  businessId: string,
  opts: { today?: Date; limit?: number; includeContactNumbers?: boolean } = {},
): Promise<WinBackList> {
  const today = opts.today ?? new Date()
  const includeContactNumbers = opts.includeContactNumbers ?? false

  const [business, rows] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    prisma.$queryRaw<WinBackRow[]>`
      SELECT m.public_id,
             m.short_code,
             m.display_name,
             (COALESCE(SUM(o.total), 0) * 100)::bigint AS cents,
             ARRAY_AGG((o.created_at AT TIME ZONE 'UTC')::date ORDER BY o.created_at) AS order_dates,
             CASE WHEN ${includeContactNumbers} THEN (
               SELECT d.contact_phone
               FROM orders po
               JOIN order_deliveries d ON d.order_id = po.id
               WHERE po.membership_id = m.id
                 AND po.business_id = ${businessId}::uuid
                 AND d.contact_phone IS NOT NULL
               ORDER BY po.created_at DESC
               LIMIT 1
             ) END AS contact_phone
      FROM memberships m
      JOIN orders o
        ON o.membership_id = m.id
       AND o.business_id = ${businessId}::uuid
       AND o.payment_status = 'PAID'
       AND o.status NOT IN ('CANCELLED', 'REFUNDED')
      WHERE m.business_id = ${businessId}::uuid
        AND m.status = 'active'
      GROUP BY m.id, m.public_id, m.short_code, m.display_name`,
  ])

  const customers: CustomerOrderHistory[] = rows.map((row) => ({
    publicId: row.public_id,
    shortCode: row.short_code,
    displayName: row.display_name,
    orderDates: row.order_dates.map((date) => date.toISOString().slice(0, 10)),
    spentCents: Number(row.cents),
    contactPhone: row.contact_phone ?? null,
  }))

  return buildWinBackList(customers, { today, businessName: business?.name ?? 'your shop', limit: opts.limit })
}
