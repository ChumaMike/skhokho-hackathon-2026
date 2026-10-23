/**
 * Storefront SEO — extends every storefront route's title-only
 * generateMetadata with description, Open Graph, Twitter card, and a
 * JSON-LD LocalBusiness schema. Pure functions over data the caller
 * already fetched (business + optional rating) — no new Prisma reads.
 *
 * AggregateRating only ever appears when getRatingSummary genuinely found
 * published reviews (count > 0) — never fabricated, same discipline as
 * StorefrontView's own rating display and storefront-recommendations.ts.
 */

import type { Metadata } from 'next'
import type { Business } from '@prisma/client'
import { categoryLabel } from '@/lib/business-categories'
import type { RatingSummary } from '@/modules/reviews/review.service'
import { canonicalStorefrontUrl } from './storefront-url'

export type StorefrontSeoPage = 'HOME' | 'ABOUT' | 'GALLERY' | 'CONTACT'

const PAGE_TITLE_SUFFIX: Record<StorefrontSeoPage, string | null> = {
  HOME: null,
  ABOUT: 'About',
  GALLERY: 'Gallery',
  CONTACT: 'Contact',
}

type SeoBusiness = Pick<
  Business,
  'name' | 'slug' | 'description' | 'category' | 'bannerUrl' | 'logoUrl' | 'suburb' | 'city'
> & {
  /** The live primary custom domain, when loaded (getBusinessBySlug includes it). */
  domains?: { hostname: string }[]
}

/**
 * Never throws on a business missing optional fields — description falls
 * back to a plain, honest one-liner (category + location) rather than
 * omitting the tag or inventing marketing copy.
 */
function buildDescription(business: SeoBusiness): string {
  if (business.description && business.description.trim()) return business.description.trim().slice(0, 300)
  const location = business.suburb || business.city
  const category = categoryLabel(business.category)
  return location ? `${business.name} — ${category} in ${location}.` : `${business.name} — ${category}.`
}

export function buildStorefrontMetadata(
  business: SeoBusiness,
  page: StorefrontSeoPage,
  /** A published storefront spec's own title/description (home page only). */
  override?: { title?: string; description?: string },
): Metadata {
  const suffix = PAGE_TITLE_SUFFIX[page]
  const title = override?.title || (suffix ? `${suffix} — ${business.name}` : `${business.name} — Skhokho`)
  const description = override?.description || buildDescription(business)
  // One canonical address however the page was reached (subdomain, legacy
  // /store/<slug> path, bookings/admin surface) — see storefront-url.ts.
  const url = canonicalStorefrontUrl(business.slug, page === 'HOME' ? '' : `/${page.toLowerCase()}`, business.domains?.[0]?.hostname)
  const image = business.bannerUrl ?? business.logoUrl ?? undefined

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'Skhokho',
      type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

/**
 * Metadata for ANY storefront page by its address — owner pages, workflow
 * pages, product pages. `seo` is the owner's own title/description for the
 * page (pages.ts), falling back to the page title and the business's
 * honest one-liner. The Open Graph image is the page's own image when it
 * has one (a product photo), else the banner, else the logo.
 */
export function buildPageMetadata(
  business: SeoBusiness,
  page: { title: string; path: string; description?: string | null; image?: string | null; seo?: { title?: string; description?: string } | null; noindex?: boolean },
): Metadata {
  const title = page.seo?.title || `${page.title} — ${business.name}`
  const description = page.seo?.description || page.description?.trim().slice(0, 300) || buildDescription(business)
  const url = canonicalStorefrontUrl(business.slug, page.path, business.domains?.[0]?.hostname)
  const image = page.image ?? business.bannerUrl ?? business.logoUrl ?? undefined
  return {
    title,
    description,
    alternates: { canonical: url },
    ...(page.noindex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      title,
      description,
      url,
      siteName: 'Skhokho',
      type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

/** Storefront paths search engines must not index: a basket, checkout, account or configurator is personal, not a page. */
export const NOINDEX_PATHS = ['basket', 'checkout', 'account', 'configure'] as const

/** Metadata that only says "don't index" — for basket and friends. */
export function noindexMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } }
}

// ---------------------------------------------------------------------------
// Structured data for what the business sells
// ---------------------------------------------------------------------------

type SeoProduct = { id: string; name: string; description: string | null; imageUrl: string | null; images: string[]; price: string | number }
type SeoService = { id: string; name: string; description: string | null; imageUrl: string | null; price: string | number; duration?: number | null }

function offer(price: string | number, url: string): Record<string, unknown> | null {
  const amount = Number(price)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { '@type': 'Offer', price: amount.toFixed(2), priceCurrency: 'ZAR', availability: 'https://schema.org/InStock', url }
}

/** schema.org Product for the product detail page. Price only when the business set one; never a rating it doesn't have. */
export function buildProductJsonLd(business: Pick<Business, 'name' | 'slug'> & { domains?: { hostname: string }[] }, product: SeoProduct): Record<string, unknown> {
  const url = canonicalStorefrontUrl(business.slug, `/product/${product.id}`, business.domains?.[0]?.hostname)
  const images = product.images.length > 0 ? product.images : product.imageUrl ? [product.imageUrl] : []
  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url,
    brand: { '@type': 'Brand', name: business.name },
  }
  if (product.description) json.description = product.description
  if (images.length > 0) json.image = images
  const offers = offer(product.price, url)
  if (offers) json.offers = offers
  return json
}

/** schema.org ItemList of Products for the Shop page (bounded — the first 50). */
export function buildProductListJsonLd(business: Pick<Business, 'name' | 'slug'> & { domains?: { hostname: string }[] }, products: SeoProduct[]): Record<string, unknown> {
  const host = business.domains?.[0]?.hostname
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    url: canonicalStorefrontUrl(business.slug, '/shop', host),
    numberOfItems: products.length,
    itemListElement: products.slice(0, 50).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: canonicalStorefrontUrl(business.slug, `/product/${p.id}`, host),
      name: p.name,
    })),
  }
}

/** schema.org Services offered by the business, for the Services page. */
export function buildServiceListJsonLd(
  business: Pick<Business, 'name' | 'slug'> & { domains?: { hostname: string }[] },
  services: SeoService[],
): Record<string, unknown> {
  const host = business.domains?.[0]?.hostname
  const url = canonicalStorefrontUrl(business.slug, '/services', host)
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    url,
    numberOfItems: services.length,
    itemListElement: services.slice(0, 50).map((s, i) => {
      const item: Record<string, unknown> = {
        '@type': 'Service',
        name: s.name,
        provider: { '@type': 'LocalBusiness', name: business.name },
      }
      if (s.description) item.description = s.description
      if (s.imageUrl) item.image = s.imageUrl
      const offers = offer(s.price, url)
      if (offers) item.offers = offers
      return { '@type': 'ListItem', position: i + 1, item }
    }),
  }
}

// ---------------------------------------------------------------------------
// Sitemap and robots per storefront
// ---------------------------------------------------------------------------

export interface SitemapEntry {
  loc: string
  lastmod?: Date | null
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** A plain sitemap: one <url> per entry, in the order given. Pure. */
export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => `  <url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/**
 * robots.txt for one storefront: everything crawlable except the personal
 * paths, and a pointer to its sitemap. `base` is the storefront's root path
 * on this host ('' on its own domain, '/store/<slug>' on the platform host).
 */
export function buildRobotsTxt(base: string, sitemapUrl: string): string {
  const lines = ['User-agent: *', ...NOINDEX_PATHS.map((p) => `Disallow: ${base}/${p}`), `Allow: ${base || '/'}`, `Sitemap: ${sitemapUrl}`]
  return `${lines.join('\n')}\n`
}

type LocalBusinessBusiness = Pick<
  Business,
  'name' | 'slug' | 'description' | 'phone' | 'address' | 'suburb' | 'city' | 'province' | 'postalCode'
> & { domains?: { hostname: string }[] }

/**
 * JSON-LD LocalBusiness — only rendered once per business (the HOME page
 * route, not every sub-page: duplicating structured data across an
 * about/gallery/contact page describes nothing extra and search engines
 * treat duplicate LocalBusiness blocks as noise, not signal).
 */
export function buildLocalBusinessJsonLd(business: LocalBusinessBusiness, rating?: RatingSummary): Record<string, unknown> {
  const url = canonicalStorefrontUrl(business.slug, '', business.domains?.[0]?.hostname)
  const hasAddress = !!(business.address || business.suburb || business.city)

  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: business.name,
    url,
  }
  if (business.description) json.description = business.description
  if (business.phone) json.telephone = business.phone
  if (hasAddress) {
    // schema.org PostalAddress: addressLocality is the city/suburb, addressRegion
    // is the province — both business.suburb AND business.city were previously
    // mapped here, silently dropping whichever wrote second. suburb is the more
    // specific locality (SA address convention), city joins it when both are
    // set rather than being discarded.
    const locality = [business.suburb, business.city].filter(Boolean).join(', ') || undefined
    json.address = {
      '@type': 'PostalAddress',
      ...(business.address ? { streetAddress: business.address } : {}),
      ...(locality ? { addressLocality: locality } : {}),
      ...(business.province ? { addressRegion: business.province } : {}),
      ...(business.postalCode ? { postalCode: business.postalCode } : {}),
      addressCountry: 'ZA',
    }
  }
  // Only when getRatingSummary genuinely found published reviews — never a fabricated 0/0.
  if (rating && rating.count > 0) {
    json.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: rating.average,
      reviewCount: rating.count,
    }
  }

  return json
}

/**
 * JSON.stringify alone is not safe to inject into a <script> tag: a
 * business-controlled field (name/description) containing a literal
 * `</script>` would close the tag early and let the rest be parsed as
 * HTML. Escaping `<` to its unicode form is the standard mitigation (same
 * one Next.js's own JSON-LD examples use) — invisible to JSON.parse,
 * un-splittable by the HTML parser.
 */
export function serializeJsonLd(json: Record<string, unknown>): string {
  return JSON.stringify(json).replace(/</g, '\\u003c')
}
