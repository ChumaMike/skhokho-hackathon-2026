import { prisma } from '@/lib/prisma/client'
import { recheckDomains } from './domain.service'
import { syncRegistration } from './domain-registration.service'

/**
 * Daily domain maintenance: re-verifies live custom domains (one whose
 * ownership proof keeps failing stops routing, so a domain that changed
 * hands can't keep serving the old business), and refreshes registrar state
 * for domains bought through Skhokho.
 */
export async function runDomainMaintenance(now: Date = new Date()) {
  const domains = await recheckDomains(now)
  const registrations = await prisma.domainRegistration.findMany({
    where: { status: { in: ['REGISTERED', 'RENEWAL_DUE'] } },
    select: { id: true, businessId: true },
    take: 200,
  })
  let synced = 0
  for (const r of registrations) {
    try {
      await syncRegistration(r.businessId, r.id, now)
      synced += 1
    } catch (e) {
      console.error('[cron/domains] registration sync failed', r.id, e instanceof Error ? e.message : e)
    }
  }
  return { domains, registrationsSynced: synced }
}
