import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWinBackList,
  firstName,
  median,
  orderGaps,
  thresholdsFor,
  GONE_DAYS,
  MIN_DAYS_SINCE,
  type CustomerOrderHistory,
} from './win-back'

/** Thursday, as in the other fixtures. */
const TODAY = new Date('2026-10-22T09:00:00Z')
const DAY_MS = 86_400_000

const daysAgo = (days: number): string => new Date(TODAY.getTime() - days * DAY_MS).toISOString().slice(0, 10)

/** Orders every `every` days, `count` of them, the last one `lastDaysAgo` ago. */
function pattern(every: number, count: number, lastDaysAgo: number): string[] {
  const dates: string[] = []
  for (let i = count - 1; i >= 0; i--) dates.push(daysAgo(lastDaysAgo + i * every))
  return dates
}

function customer(over: Partial<CustomerOrderHistory> & { publicId: string }): CustomerOrderHistory {
  return {
    shortCode: 'KT-0001',
    displayName: 'Thandi Mokoena',
    orderDates: pattern(7, 4, 30),
    spentCents: 50_000,
    contactPhone: null,
    ...over,
  }
}

const list = (customers: CustomerOrderHistory[], opts = {}) =>
  buildWinBackList(customers, { today: TODAY, businessName: 'Kota Tainment', ...opts })

// ---------------------------------------------------------------------------
// The small sums
// ---------------------------------------------------------------------------

test('the median is the middle value, and the mean of the middle two when even', () => {
  assert.equal(median([5]), 5)
  assert.equal(median([1, 5, 9]), 5)
  assert.equal(median([2, 4, 6, 10]), 5)
  assert.equal(median([]), null)
})

test('gaps are the days between consecutive orders, however the dates arrive', () => {
  assert.deepEqual(orderGaps(['2026-10-01', '2026-10-08', '2026-10-15']), [7, 7])
  assert.deepEqual(orderGaps(['2026-10-15', '2026-10-01', '2026-10-08']), [7, 7])
  assert.deepEqual(orderGaps(['2026-10-01']), [])
})

test('the name shown is the first name, or the short code when there is no name', () => {
  assert.equal(firstName('Thandi Mokoena', 'KT-0001'), 'Thandi')
  assert.equal(firstName('Sipho', 'KT-0002'), 'Sipho')
  assert.equal(firstName(null, 'KT-0003'), 'KT-0003')
  assert.equal(firstName('   ', 'KT-0004'), 'KT-0004')
})

test('the bands keep their distance from the one-week floor, whatever the gap', () => {
  // A customer who orders every second day: slipping at a week, overdue at
  // about twelve days, gone at about three weeks — not gone after one week.
  const daily = thresholdsFor(2)
  assert.equal(daily.slippingAt, MIN_DAYS_SINCE)
  assert.ok(daily.overdueAt > daily.slippingAt)
  assert.ok(daily.goneAt > daily.overdueAt)
  assert.ok(daily.goneAt > 20 && daily.goneAt < 25)

  // A monthly customer: slipping at 36 days, and gone capped at 90.
  const monthly = thresholdsFor(30)
  assert.equal(monthly.slippingAt, 36)
  assert.equal(monthly.overdueAt, 60)
  assert.equal(monthly.goneAt, GONE_DAYS)
})

// ---------------------------------------------------------------------------
// Who lands on the list
// ---------------------------------------------------------------------------

test('a customer still inside their own rhythm is left alone', () => {
  const weekly = customer({ publicId: 'p-weekly', orderDates: pattern(7, 5, 5) })
  assert.deepEqual(list([weekly]).customers, [])
  assert.equal(list([weekly]).consideredCount, 1)
})

test('nobody is flagged inside a week, however often they usually order', () => {
  const daily = customer({ publicId: 'p-daily', orderDates: pattern(2, 8, 6) })
  assert.deepEqual(list([daily]).customers, [])
})

test('a frequent customer gone quiet for a week is slipping, not written off', () => {
  const daily = customer({ publicId: 'p-daily', orderDates: pattern(2, 8, 8) })
  const [row] = list([daily]).customers
  assert.ok(row)
  assert.equal(row.status, 'slipping')
  assert.equal(row.typicalGapDays, 2)
  assert.equal(row.daysSince, 8)
  assert.match(row.action, /Usually in every 2 days, and it has been 8/)
})

test('a monthly customer at three weeks is not slipping — their month is not up', () => {
  const monthly = customer({ publicId: 'p-monthly', orderDates: pattern(30, 4, 21) })
  assert.deepEqual(list([monthly]).customers, [])
})

test('a monthly customer at two months is overdue', () => {
  const monthly = customer({ publicId: 'p-monthly', orderDates: pattern(30, 4, 62) })
  const [row] = list([monthly]).customers
  assert.ok(row)
  assert.equal(row.status, 'overdue')
  assert.match(row.action, /Well past their usual 30 days/)
})

test('past ninety days a customer is counted as gone, whatever their gap was', () => {
  const monthly = customer({ publicId: 'p-gone', orderDates: pattern(30, 4, 100), spentCents: 120_000 })
  const [row] = list([monthly]).customers
  assert.ok(row)
  assert.equal(row.status, 'gone')
  assert.match(row.action, /No order in 100 days, and they spent R 1 200\.00 here/)
  assert.match(row.action, /then leave them be/)
})

test('a customer who ordered once is measured against the shop own usual gap', () => {
  const regulars = [
    customer({ publicId: 'p-a', orderDates: pattern(10, 5, 3) }),
    customer({ publicId: 'p-b', orderDates: pattern(10, 5, 2) }),
  ]
  const once = customer({ publicId: 'p-once', orderDates: [daysAgo(15)] })
  const result = list([...regulars, once])
  assert.equal(result.businessGapDays, 10)
  const [row] = result.customers
  assert.ok(row)
  assert.equal(row.publicId, 'p-once')
  assert.equal(row.typicalGapDays, null)
  assert.equal(row.measuredAgainstDays, 10)
  assert.equal(row.status, 'slipping')
  assert.match(row.action, /since their first and only order/)
  assert.match(result.method.join(' '), /measured against your shop's usual gap of 10 days/)
})

test('with no shop pattern at all, a one-order customer is measured against a month', () => {
  const once = customer({ publicId: 'p-once', orderDates: [daysAgo(40)] })
  const result = list([once])
  assert.equal(result.businessGapDays, null)
  assert.equal(result.customers[0]?.measuredAgainstDays, 30)
  assert.equal(result.customers[0]?.status, 'slipping')
  assert.match(result.method.join(' '), /measured against 30 days, until your shop has a pattern/)
})

test('a customer who has never paid for anything is not on the list at all', () => {
  const result = list([customer({ publicId: 'p-none', orderDates: [] })])
  assert.deepEqual(result.customers, [])
  assert.equal(result.consideredCount, 0)
})

// ---------------------------------------------------------------------------
// Order, counts and money
// ---------------------------------------------------------------------------

test('winnable customers come before the ones already gone, biggest spender first', () => {
  const result = list([
    customer({ publicId: 'p-gone-big', orderDates: pattern(7, 3, 100), spentCents: 900_000 }),
    customer({ publicId: 'p-slipping-small', orderDates: pattern(7, 3, 9), spentCents: 10_000 }),
    customer({ publicId: 'p-overdue-big', orderDates: pattern(7, 3, 20), spentCents: 300_000 }),
    customer({ publicId: 'p-slipping-big', orderDates: pattern(7, 3, 9), spentCents: 80_000 }),
  ])
  assert.deepEqual(
    result.customers.map((row) => [row.publicId, row.status]),
    [
      ['p-slipping-big', 'slipping'],
      ['p-slipping-small', 'slipping'],
      ['p-overdue-big', 'overdue'],
      ['p-gone-big', 'gone'],
    ],
  )
  assert.deepEqual(result.counts, { slipping: 2, overdue: 1, gone: 1 })
  assert.equal(result.atRiskDisplay, 'R 12 900.00')
})

test('the list is capped, and the method says how many were held back', () => {
  const many = Array.from({ length: 25 }, (_, i) =>
    customer({ publicId: `p-${i}`, orderDates: pattern(7, 3, 20), spentCents: (i + 1) * 1_000 }),
  )
  const result = list(many, { limit: 5 })
  assert.equal(result.customers.length, 5)
  // Biggest spenders kept.
  assert.deepEqual(result.customers.map((row) => row.spentCents), [25_000, 24_000, 23_000, 22_000, 21_000])
  assert.equal(result.counts.overdue, 25)
  assert.match(result.method.join(' '), /25 are on this list, and the top 5 are shown/)
})

// ---------------------------------------------------------------------------
// Contacting them — and the privacy boundary
// ---------------------------------------------------------------------------

test('a WhatsApp link is built only where the customer left a mobile number', () => {
  const withPhone = customer({ publicId: 'p-phone', orderDates: pattern(7, 3, 20), contactPhone: '082 123 4567' })
  const withoutPhone = customer({ publicId: 'p-nophone', orderDates: pattern(7, 3, 20), contactPhone: null })
  const rows = list([withPhone, withoutPhone]).customers
  const a = rows.find((row) => row.publicId === 'p-phone')!
  const b = rows.find((row) => row.publicId === 'p-nophone')!
  assert.ok(a && b)

  assert.ok(a.whatsappUrl?.startsWith('https://wa.me/27821234567?text='))
  assert.equal(a.contactNote, null)
  const message = decodeURIComponent(a.whatsappUrl!.split('?text=')[1]!)
  assert.match(message, /^Hi Thandi, it's Kota Tainment\./)

  assert.equal(b.whatsappUrl, null)
  assert.match(b.contactNote!, /No contact number on file/)
  assert.match(b.contactNote!, /short code/)
})

test('a number that is not a messageable mobile says so instead of making a dead link', () => {
  const landline = customer({ publicId: 'p-landline', orderDates: pattern(7, 3, 20), contactPhone: '011 123 4567' })
  const [row] = list([landline]).customers
  assert.ok(row)
  assert.equal(row.whatsappUrl, null)
  assert.match(row.contactNote!, /not a mobile we can message/)
})

test('a customer who has gone is sent a gentler message than one who is slipping', () => {
  const gone = customer({ publicId: 'p-gone', orderDates: pattern(7, 3, 100), contactPhone: '082 123 4567' })
  const slipping = customer({ publicId: 'p-slip', orderDates: pattern(7, 3, 9), contactPhone: '082 123 4567' })
  const rows = list([gone, slipping]).customers
  const text = (publicId: string) =>
    decodeURIComponent(rows.find((row) => row.publicId === publicId)!.whatsappUrl!.split('?text=')[1]!)
  assert.match(text('p-gone'), /It's been a long while/)
  assert.match(text('p-slip'), /haven't seen you in a bit/)
})

test('the list carries the pairwise public id and the short code, never a global id', () => {
  const result = list([customer({ publicId: 'p-a', shortCode: 'KT-0042', orderDates: pattern(7, 3, 20) })])
  const [row] = result.customers
  assert.ok(row)
  assert.equal(row.publicId, 'p-a')
  assert.equal(row.shortCode, 'KT-0042')
  assert.equal(Object.keys(row).includes('customerId'), false)
  // The name shown is a first name only, never the full name the shop holds.
  assert.equal(row.name, 'Thandi')
  assert.equal(JSON.stringify(row).includes('Mokoena'), false)
})

test('the method explains the rule and the week floor', () => {
  const method = list([customer({ publicId: 'p-a', orderDates: pattern(7, 3, 20) })]).method.join(' ')
  assert.match(method, /measured against their OWN pattern/)
  assert.match(method, /Nobody is listed inside 7 days/)
  assert.match(method, /nobody is written off after one quiet week/)
  assert.match(method, /Paid orders only/)
})
