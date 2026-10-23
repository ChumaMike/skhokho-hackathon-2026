/**
 * Cart-line identity (Food Menu Domain Foundation §11) — productId +
 * normalized (deduped, sorted) selected option ids. Deliberately a tiny,
 * dependency-free module: both the CLIENT basket (lib/storefront/cart.ts,
 * bundled into the browser) and the SERVER authoritative quote resolver
 * (modules/orders/storefront-cart.ts, which imports the Prisma client)
 * need the exact same key, and the client side must never pull in a
 * server-only module transitively just for this one pure function.
 */
export function computeLineKey(productId: string, optionIds: string[] | undefined): string {
  const normalized = [...new Set(optionIds ?? [])].sort()
  return normalized.length === 0 ? productId : `${productId}::${normalized.join(',')}`
}
