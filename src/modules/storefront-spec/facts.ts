/**
 * Business understanding — the facts the storefront pipeline works from.
 *
 * Privacy by construction: this is everything the planner and the AI ever
 * see about a business, and it holds no customer, order, staff or payment
 * data, and no phone numbers, emails or addresses — only WHETHER a contact
 * channel exists. Catalogue item names and the business's own public
 * description/brief are the only free text.
 *
 * `gatherStorefrontFacts` is the only database read; everything downstream
 * is pure and works on `StorefrontFacts`.
 */

import type { BusinessCategory } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { getBusinessCapabilities, getDeliverySettings, type BusinessCapability } from '@/modules/tenant/capabilities'
import { getStorefrontConfig, type StorefrontGoal, type StorefrontPresetId, type StorefrontVoiceTone } from '@/modules/tenant/storefront-theme'
import { getStorefrontContent, type StorefrontContent } from '@/modules/tenant/storefront-content'
import { formatOperatingHours } from '@/modules/tenant/storefront-hours'
import { resolveStorefrontVariant } from '@/modules/tenant/shopfront-eligibility'
import type { SpecTemplate } from './spec'
import type { TemplateId } from './templates'
import { getStorefrontLayout } from './layout'
import { getPublishedSite, type SiteSpec } from './pages'
import { activeWorkflows, WORKFLOWS_FEATURE, type WorkflowId } from '@/modules/storefront-workflows/workflows'
import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import { hasFeature } from '@/modules/billing/entitlements'

const SAMPLE_NAMES = 8

export interface StorefrontFacts {
  name: string
  slug: string
  category: BusinessCategory
  description: string | null
  location: { suburb: string | null; city: string | null; province: string | null }
  capabilities: BusinessCapability[]
  contact: { phone: boolean; whatsapp: boolean; email: boolean; address: boolean }
  brand: { primaryColor: string | null; accentColor: string | null; hasLogo: boolean; hasBanner: boolean }
  products: { count: number; withImages: number; sampleNames: string[] }
  services: { count: number; withImages: number; sampleNames: string[] }
  hoursConfigured: boolean
  deliveryEnabled: boolean
  reviewCount: number
  /** The owner's own storefront interview answers, if any. */
  profile: { goal?: StorefrontGoal; voiceTone?: StorefrontVoiceTone; differentiator?: string; feeling?: StorefrontPresetId }
  /** The onboarding brief, written from the owner's own interview. */
  brief: string | null
  /** What the live storefront shows today — Level A (assist) keeps its structure. */
  current: {
    template: SpecTemplate
    templateId: TemplateId | null
    content: StorefrontContent
    /** The owner's published pages, or null when they have never published any (pages.ts). */
    site: SiteSpec | null
  }
  /** Product and service photos on the catalogue — decides whether a Gallery page has anything to show. */
  imageCount: number
  /** Storefront workflows the business can run today: switched on AND included in its plan (storefront-workflows/workflows.ts). */
  workflows: WorkflowId[]
}

/** Contact presence for capability checks (getAvailablePrimaryActions wants field-shaped input). */
export function contactFields(facts: StorefrontFacts) {
  return {
    whatsapp: facts.contact.whatsapp ? 'yes' : null,
    phone: facts.contact.phone ? 'yes' : null,
    address: facts.contact.address ? 'yes' : null,
    suburb: null,
    city: null,
  }
}

export function capabilitySet(facts: StorefrontFacts): Set<BusinessCapability> {
  return new Set(facts.capabilities)
}

/** Reads one business's facts. Keyed by the session's businessId — never client input. */
export async function gatherStorefrontFacts(businessId: string): Promise<StorefrontFacts> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      name: true,
      slug: true,
      category: true,
      description: true,
      suburb: true,
      city: true,
      province: true,
      address: true,
      phone: true,
      whatsapp: true,
      email: true,
      primaryColor: true,
      accentColor: true,
      logoUrl: true,
      bannerUrl: true,
      settings: true,
      operatingHours: true,
      profile: { select: { brief: true } },
    },
  })

  const [products, services, reviewCount] = await Promise.all([
    prisma.product.findMany({
      where: { businessId, isActive: true },
      select: { name: true, imageUrl: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.service.findMany({
      where: { businessId, isActive: true },
      select: { name: true, imageUrl: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.review.count({ where: { businessId, isPublished: true } }),
  ])

  const variant = resolveStorefrontVariant(business)
  const storefront = getStorefrontConfig(business)
  const capabilities = getBusinessCapabilities(business)
  // Workflows need the plan as well as the capability; the plan is only
  // looked up when at least one workflow capability is switched on.
  const wantsWorkflows = activeWorkflows(capabilities, true).length > 0
  const planAllows = wantsWorkflows ? hasFeature(await getBusinessEntitlements(businessId), WORKFLOWS_FEATURE) : false

  return {
    name: business.name,
    slug: business.slug,
    category: business.category,
    description: business.description?.trim() || null,
    location: { suburb: business.suburb, city: business.city, province: business.province },
    capabilities: [...capabilities],
    contact: {
      phone: Boolean(business.phone),
      whatsapp: Boolean(business.whatsapp),
      email: Boolean(business.email),
      address: Boolean(business.address || business.suburb || business.city),
    },
    brand: {
      primaryColor: business.primaryColor,
      accentColor: business.accentColor,
      hasLogo: Boolean(business.logoUrl),
      hasBanner: Boolean(business.bannerUrl),
    },
    products: {
      count: products.length,
      withImages: products.filter((p) => p.imageUrl).length,
      sampleNames: products.slice(0, SAMPLE_NAMES).map((p) => p.name),
    },
    services: {
      count: services.length,
      withImages: services.filter((s) => s.imageUrl).length,
      sampleNames: services.slice(0, SAMPLE_NAMES).map((s) => s.name),
    },
    hoursConfigured: formatOperatingHours(business.operatingHours).length > 0,
    deliveryEnabled: getDeliverySettings(business).enabled,
    reviewCount,
    profile: {
      goal: storefront.profile.goal,
      voiceTone: storefront.profile.voiceTone,
      differentiator: storefront.profile.differentiator,
      feeling: storefront.profile.feeling,
    },
    brief: business.profile?.brief?.trim() || null,
    current: {
      template: variant === 'BOOKING' ? 'BOOKING' : 'PRODUCT',
      templateId: getStorefrontLayout(business)?.templateId ?? null,
      content: getStorefrontContent(business),
      site: getPublishedSite(business),
    },
    imageCount: products.filter((p) => p.imageUrl).length + services.filter((s) => s.imageUrl).length,
    workflows: activeWorkflows(capabilities, planAllows),
  }
}
