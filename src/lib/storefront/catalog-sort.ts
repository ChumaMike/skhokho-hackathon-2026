/**
 * Customer-side price sort for storefront menus and grids. A plain module
 * (no "use client") so the server-rendered menu and the client grid share
 * one rule. "Default" keeps the owner's own order (featured, then their
 * sort order, then name — catalog.service.ts); the two price orders are
 * stable, so items at the same price keep the owner's order between them.
 */

export const PRODUCT_SORTS = ['default', 'price_asc', 'price_desc'] as const
export type ProductSort = (typeof PRODUCT_SORTS)[number]

export const PRODUCT_SORT_LABELS: Record<ProductSort, string> = {
  default: 'Our order',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
}

/** The sort a URL or control asked for, or "default" for anything unknown. */
export function parseProductSort(value: string | null | undefined): ProductSort {
  return (PRODUCT_SORTS as readonly string[]).includes(value ?? '') ? (value as ProductSort) : 'default'
}

/** Returns a new array; never mutates the catalogue it was given. Unparseable prices sort last. */
export function sortProducts<P extends { price: string | number }>(products: P[], sort: ProductSort): P[] {
  if (sort === 'default') return [...products]
  const price = (p: P) => {
    const n = typeof p.price === 'number' ? p.price : Number(p.price)
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
  }
  const dir = sort === 'price_asc' ? 1 : -1
  return [...products].sort((a, b) => {
    const pa = price(a)
    const pb = price(b)
    if (pa === pb) return 0
    if (pa === Number.POSITIVE_INFINITY) return 1
    if (pb === Number.POSITIVE_INFINITY) return -1
    return (pa - pb) * dir
  })
}
