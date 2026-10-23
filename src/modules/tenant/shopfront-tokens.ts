import { buildStorefrontColorTokens, STOREFRONT_PAGE_BG, STOREFRONT_PAGE_FG, STOREFRONT_PAGE_MUTED, STOREFRONT_PAGE_BORDER } from '@/lib/storefront-colors'

/**
 * Connected Shopfront — one fixed, premium visual identity (not a 6-way
 * preset like the old system — see shopfront-eligibility.ts's comment on
 * why this is a separate design, not an extension of storefront-theme.ts).
 * Only the accent colours vary per business, via the same real, tested
 * contrast-safe colour pipeline the old system already uses
 * (buildStorefrontColorTokens) — never the prototype's hardcoded amber/veld
 * hex literals. Neutrals reuse the storefront's own fixed, non-flipping
 * page chrome (STOREFRONT_PAGE_*), the same ones StorefrontView already
 * relies on, for the same reason: must never change under a visitor's OS
 * `prefers-color-scheme`.
 */
export function resolveShopfrontTokens(business: {
  primaryColor?: string | null
  accentColor?: string | null
}): Record<string, string> {
  const colors = buildStorefrontColorTokens(business)
  return {
    '--shop-bg': STOREFRONT_PAGE_BG,
    '--shop-fg': STOREFRONT_PAGE_FG,
    '--shop-muted': STOREFRONT_PAGE_MUTED,
    '--shop-border': STOREFRONT_PAGE_BORDER,
    '--shop-board': '#171009',
    '--shop-ink': '#0E0A05',
    '--shop-cream': '#FFF9EE',
    '--shop-primary': colors['--store-primary'],
    '--shop-primary-safe': colors['--store-primary-safe'],
    '--shop-on-primary': colors['--store-on-primary'],
    '--shop-accent': colors['--store-accent'],
    '--shop-accent-safe': colors['--store-accent-safe'],
    '--shop-on-accent': colors['--store-on-accent'],
    '--shop-radius': '22px',
    '--shop-radius-sm': '12px',
  }
}
