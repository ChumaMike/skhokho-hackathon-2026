/**
 * Skhokho Laboratory managed services — people doing the work for a merchant.
 *
 * Deliberately NOT the same thing as a SaaS capability included in a plan.
 * The Content Studio is software the merchant uses themselves and is included
 * in GROW and PRO; the "Managed Content & Marketing Service" below is Skhokho
 * Labs writing and scheduling their posts for them. Conflating the two was
 * the reason the R5 000 offering used to be called "Content dashboard".
 *
 * These are services, never a commission on a merchant's own sales. Skhokho
 * Laboratory takes no percentage of merchant turnover — customer payments go
 * straight into each merchant's own PayFast account.
 *
 * Sold by enquiry only. Nothing here is self-service purchasable in Phase A:
 * the studio closes the deal, an admin records a BusinessAddon, and the
 * monthly portion then bills automatically alongside the plan. Delivery work
 * lives in ChumaMike/skhokho-labs, not in this app.
 *
 * Prices in integer cents, per docs/specs/2026-10-21-plans.md §12.
 */

export interface ManagedService {
  slug: string
  name: string
  blurb: string
  setupCents: number
  monthlyCents: number
  /** True when the quoted figure is a floor ("from R1 500"), not a fixed price. */
  setupFrom: boolean
  monthlyFrom: boolean
}

export const MANAGED_SERVICES: ManagedService[] = [
  {
    slug: 'website',
    name: 'Custom Website Service',
    blurb: 'A site for your business, built and hosted for you.',
    setupCents: 150_000,
    monthlyCents: 30_000,
    setupFrom: true,
    monthlyFrom: true,
  },
  {
    slug: 'whatsapp-ordering',
    name: 'WhatsApp Ordering Service',
    blurb: 'Customers order straight from a WhatsApp chat — no app needed.',
    setupCents: 300_000,
    monthlyCents: 100_000,
    setupFrom: false,
    monthlyFrom: false,
  },
  {
    slug: 'voice-agent',
    name: 'AI Voice Agent',
    blurb: 'Answers your phone and books the job while your hands are full.',
    setupCents: 250_000,
    monthlyCents: 150_000,
    setupFrom: true,
    monthlyFrom: true,
  },
  {
    slug: 'content',
    // Renamed from "Content dashboard": this is the managed service, not the
    // Content Studio included in GROW and PRO.
    name: 'Managed Content & Marketing Service',
    blurb: 'Social posts written and scheduled for your business every week.',
    setupCents: 500_000,
    monthlyCents: 150_000,
    setupFrom: false,
    monthlyFrom: false,
  },
  {
    slug: 'speed-to-lead',
    name: 'Speed-to-Lead',
    blurb: 'New enquiries get an instant reply, before they call someone else.',
    setupCents: 450_000,
    monthlyCents: 100_000,
    setupFrom: false,
    monthlyFrom: true,
  },
]

export function managedService(slug: string): ManagedService | null {
  return MANAGED_SERVICES.find((s) => s.slug === slug) ?? null
}

export function isManagedServiceSlug(slug: string): boolean {
  return MANAGED_SERVICES.some((s) => s.slug === slug)
}
