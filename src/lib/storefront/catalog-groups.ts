/**
 * Catalogue grouping shared by every storefront catalogue display (the
 * classic products section and the menu-first template's menu). A plain
 * module — no "use client" — so server and client components can both call it.
 */

export interface GroupableProduct {
  categoryId: string | null
  categoryName: string | null
}

export interface CategoryGroup<P extends GroupableProduct = GroupableProduct> {
  id: string | null
  name: string | null
  products: P[]
}


/**
 * Groups by category in first-seen order (a proxy for the owner's own
 * catalogue ordering — see catalog.service.ts's sortOrder), uncategorised
 * items collected into their own group and rendered last — "a sensible
 * location," never dropped (§9/§19). A business with no categories at all
 * (every existing Food business today, until an owner adds one) gets
 * exactly one group with no heading, identical to the pre-Phase-4 flat
 * list.
 */
export function groupByCategory<P extends GroupableProduct>(products: P[]): CategoryGroup<P>[] {
  const groups = new Map<string | null, CategoryGroup<P>>();
  for (const product of products) {
    const key = product.categoryId;
    if (!groups.has(key)) groups.set(key, { id: key, name: product.categoryName, products: [] });
    groups.get(key)!.products.push(product);
  }
  const uncategorised = groups.get(null);
  const categorised = [...groups.values()].filter((g) => g.id !== null);
  return uncategorised ? [...categorised, uncategorised] : categorised;
}
