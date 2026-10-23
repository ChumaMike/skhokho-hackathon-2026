/**
 * The storefront's website for one request: its pages, nav and footer
 * links, resolved from the business row plus a few counts. Every storefront
 * route and both Shopfront home variants go through here, so the nav on
 * the About page can never disagree with the nav on Home.
 *
 * Sits beside pages.ts (pure model) because it needs the live variant and
 * terminology from the tenant modules, which themselves import the spec.
 */

import type { BusinessCategory } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { getBusinessCapabilities, type BusinessCapability } from '@/modules/tenant/capabilities'
import { getBusinessExperience } from '@/modules/tenant/business-experience'
import { resolveStorefrontVariant } from '@/modules/tenant/shopfront-eligibility'
import { getStorefrontContent } from '@/modules/tenant/storefront-content'
import type { BusinessCatalog } from '@/modules/catalog/catalog.service'
import { activeWorkflowsFor } from '@/modules/storefront-workflows/access'
import type { WorkflowId } from '@/modules/storefront-workflows/workflows'
import type { GalleryLayout } from './layouts'
import {
  getStorefrontPages,
  pageHasContent,
  resolveFooterItems,
  resolveNavItems,
  type NavItem,
  type PageContentFacts,
  type SiteDefaultsInput,
  type SitePage,
} from './pages'

type SiteBusiness = {
  id: string
  category: BusinessCategory
  settings: unknown
  description: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  address: string | null
  suburb: string | null
  city: string | null
}

export interface ResolvedSite {
  pages: SitePage[]
  nav: NavItem[]
  footer: NavItem[]
  facts: PageContentFacts
  capabilities: Set<BusinessCapability>
  /** Workflows the business can run today (capability AND plan). */
  workflows: WorkflowId[]
  /** The owner's gallery layout (from the Gallery page's section), reused by the portfolio composition on Home. */
  galleryLayout: GalleryLayout
  defaults: SiteDefaultsInput
}

export function siteDefaultsFor(business: { category: BusinessCategory; settings: unknown }, workflows: readonly WorkflowId[] = []): SiteDefaultsInput {
  return {
    category: business.category,
    capabilities: getBusinessCapabilities(business),
    variant: resolveStorefrontVariant(business),
    catalogLabel: getBusinessExperience(business.category).catalogLabel,
    workflows,
  }
}

/** Pure: pages + nav + footer from a business row and counts the caller already has. */
export function resolveSite(
  business: SiteBusiness,
  basePath: string,
  counts: { productCount: number; serviceCount: number; imageCount: number; reviewCount: number },
  workflows: readonly WorkflowId[] = [],
): ResolvedSite {
  const defaults = siteDefaultsFor(business, workflows)
  const facts: PageContentFacts = {
    ...counts,
    hasAbout: Boolean(business.description || getStorefrontContent(business).about.body),
    hasContact: Boolean(business.phone || business.whatsapp || business.email || business.address || business.suburb || business.city),
    workflows,
  }
  const pages = getStorefrontPages(business, defaults)
  const gallerySection = pages.find((p) => p.kind === 'GALLERY')?.sections.find((s) => s.type === 'GALLERY')
  // The customer's account (Tab 3's route under /account) is always the last link, in the nav and the footer.
  const account: NavItem = { id: 'ACCOUNT', label: 'Account', href: `${basePath}/account` }
  return {
    pages,
    nav: [...resolveNavItems(pages, basePath, facts), account],
    footer: [...resolveFooterItems(pages, basePath, facts), account],
    facts,
    capabilities: defaults.capabilities,
    workflows: [...workflows],
    galleryLayout: gallerySection && gallerySection.type === 'GALLERY' ? (gallerySection.layout ?? 'GRID') : 'GRID',
    defaults,
  }
}

export function catalogCounts(catalog: BusinessCatalog): { productCount: number; serviceCount: number; imageCount: number } {
  const productImages = catalog.products.reduce((n, p) => n + (p.images.length > 0 ? p.images.length : p.imageUrl ? 1 : 0), 0)
  const serviceImages = catalog.services.filter((s) => s.imageUrl).length
  return { productCount: catalog.products.length, serviceCount: catalog.services.length, imageCount: productImages + serviceImages }
}

/**
 * Resolves the site for a route. Pass the catalog and review count when the
 * page already fetched them (Home does); otherwise the counts are loaded
 * here — three small queries, so a Contact page knows whether to list a
 * Gallery or Reviews link.
 */
export async function loadSite(
  business: SiteBusiness,
  basePath: string,
  known: { catalog?: BusinessCatalog; reviewCount?: number } = {},
): Promise<ResolvedSite> {
  const counts = known.catalog
    ? catalogCounts(known.catalog)
    : await (async () => {
        const [products, services] = await Promise.all([
          prisma.product.findMany({ where: { businessId: business.id, isActive: true }, select: { imageUrl: true, images: true } }),
          prisma.service.findMany({ where: { businessId: business.id, isActive: true }, select: { imageUrl: true } }),
        ])
        return {
          productCount: products.length,
          serviceCount: services.length,
          imageCount: products.reduce((n, p) => n + (p.images.length > 0 ? p.images.length : p.imageUrl ? 1 : 0), 0) + services.filter((s) => s.imageUrl).length,
        }
      })()
  const [reviewCount, workflows] = await Promise.all([
    known.reviewCount ?? prisma.review.count({ where: { businessId: business.id, isPublished: true } }),
    activeWorkflowsFor(business.id, getBusinessCapabilities(business)),
  ])
  return resolveSite(business, basePath, { ...counts, reviewCount }, workflows)
}

/** A page that can be opened right now: visible, servable and with something to show. */
export function openablePage(site: ResolvedSite, slug: string): SitePage | null {
  const page = site.pages.find((p) => p.kind !== 'HOME' && p.slug === slug)
  if (!page || !page.visible || !pageHasContent(page, site.facts)) return null
  return page
}
