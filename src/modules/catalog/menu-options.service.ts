/**
 * Food Menu Domain Foundation (Phase 4) — Menu Category and
 * MenuOptionGroup/MenuOption/ProductOptionGroup management. Same
 * "owner-facing management requires an authenticated, permission-checked
 * caller; every read/write scoped by businessId" posture as
 * catalog.service.ts, which this module sits directly alongside — Product
 * remains the one sellable base item (§2), these are food-specific related
 * models attached to it.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'

// ---------------------------------------------------------------------------
// Menu categories (reuses ProductCategory — see schema.prisma's own comment
// on why this isn't a new "MenuCategory" table)
// ---------------------------------------------------------------------------

export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
})
export const UpdateCategorySchema = CreateCategorySchema.partial()

export async function listCategoriesForOwner(businessId: string) {
  return prisma.productCategory.findMany({
    where: { businessId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
}

export async function createCategory(businessId: string, input: z.infer<typeof CreateCategorySchema>) {
  const validated = CreateCategorySchema.parse(input)
  const maxSort = await prisma.productCategory.aggregate({ where: { businessId }, _max: { sortOrder: true } })
  return prisma.productCategory.create({
    data: {
      businessId,
      name: validated.name,
      description: validated.description,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  })
}

export async function updateCategory(businessId: string, categoryId: string, input: z.infer<typeof UpdateCategorySchema>) {
  const validated = UpdateCategorySchema.parse(input)
  const category = await prisma.productCategory.findFirst({ where: { id: categoryId, businessId } })
  if (!category) throw new Error('Category not found')
  return prisma.productCategory.update({ where: { id: categoryId }, data: validated })
}

export async function setCategoryActive(businessId: string, categoryId: string, isActive: boolean) {
  const category = await prisma.productCategory.findFirst({ where: { id: categoryId, businessId } })
  if (!category) throw new Error('Category not found')
  return prisma.productCategory.update({ where: { id: categoryId }, data: { isActive } })
}

/** Move a category one step up or down in the storefront order; priorities are renumbered densely. */
export async function moveCategory(businessId: string, categoryId: string, direction: 'UP' | 'DOWN') {
  const categories = await listCategoriesForOwner(businessId)
  const index = categories.findIndex((c) => c.id === categoryId)
  if (index === -1) throw new Error('Category not found')
  const swapWith = direction === 'UP' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= categories.length) return
  const order = categories.map((c) => c.id)
  ;[order[index], order[swapWith]] = [order[swapWith], order[index]]
  await prisma.$transaction(order.map((id, sortOrder) => prisma.productCategory.updateMany({ where: { id, businessId }, data: { sortOrder } })))
}

/**
 * Hard delete — Product.categoryId is `onDelete: SetNull` (see schema), so
 * every product in this category simply becomes uncategorised, exactly the
 * same valid state every product starts in (§3/§19: "uncategorised items
 * must remain valid").
 */
export async function deleteCategory(businessId: string, categoryId: string) {
  const category = await prisma.productCategory.findFirst({ where: { id: categoryId, businessId } })
  if (!category) throw new Error('Category not found')
  await prisma.productCategory.delete({ where: { id: categoryId } })
}

// ---------------------------------------------------------------------------
// Menu option groups
// ---------------------------------------------------------------------------

export const CreateOptionGroupSchema = z.object({
  name: z.string().min(1).max(100),
  selectionType: z.enum(['SINGLE', 'MULTIPLE']).default('SINGLE'),
  minSelections: z.number().int().min(0).max(50).default(0),
  maxSelections: z.number().int().min(1).max(50).optional(),
})
export const UpdateOptionGroupSchema = CreateOptionGroupSchema.partial()

function validateSelectionBounds(input: { selectionType?: 'SINGLE' | 'MULTIPLE'; minSelections?: number; maxSelections?: number }) {
  if (input.maxSelections !== undefined && input.minSelections !== undefined && input.maxSelections < input.minSelections) {
    throw new Error('Maximum selections cannot be less than minimum selections.')
  }
  if (input.selectionType === 'SINGLE' && input.maxSelections !== undefined && input.maxSelections > 1) {
    throw new Error('A single-choice group cannot allow more than one selection.')
  }
}

export async function listOptionGroupsForOwner(businessId: string) {
  return prisma.menuOptionGroup.findMany({
    where: { businessId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
  })
}

export async function createOptionGroup(businessId: string, input: z.infer<typeof CreateOptionGroupSchema>) {
  const validated = CreateOptionGroupSchema.parse(input)
  validateSelectionBounds(validated)
  const maxSort = await prisma.menuOptionGroup.aggregate({ where: { businessId }, _max: { sortOrder: true } })
  return prisma.menuOptionGroup.create({
    data: {
      businessId,
      name: validated.name,
      selectionType: validated.selectionType,
      minSelections: validated.minSelections,
      maxSelections: validated.maxSelections,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  })
}

export async function updateOptionGroup(
  businessId: string,
  groupId: string,
  input: z.infer<typeof UpdateOptionGroupSchema>,
) {
  const validated = UpdateOptionGroupSchema.parse(input)
  const group = await prisma.menuOptionGroup.findFirst({ where: { id: groupId, businessId } })
  if (!group) throw new Error('Option group not found')
  validateSelectionBounds({
    selectionType: validated.selectionType ?? (group.selectionType as 'SINGLE' | 'MULTIPLE'),
    minSelections: validated.minSelections ?? group.minSelections,
    maxSelections: validated.maxSelections !== undefined ? validated.maxSelections : (group.maxSelections ?? undefined),
  })
  return prisma.menuOptionGroup.update({ where: { id: groupId }, data: validated })
}

export async function setOptionGroupActive(businessId: string, groupId: string, isActive: boolean) {
  const group = await prisma.menuOptionGroup.findFirst({ where: { id: groupId, businessId } })
  if (!group) throw new Error('Option group not found')
  return prisma.menuOptionGroup.update({ where: { id: groupId }, data: { isActive } })
}

/** Hard delete — cascades to its MenuOptions and ProductOptionGroup assignments (schema `onDelete: Cascade`). Never touches historical OrderItemOption rows (`onDelete: SetNull`, snapshot fields already carry the truth). */
export async function deleteOptionGroup(businessId: string, groupId: string) {
  const group = await prisma.menuOptionGroup.findFirst({ where: { id: groupId, businessId } })
  if (!group) throw new Error('Option group not found')
  await prisma.menuOptionGroup.delete({ where: { id: groupId } })
}

// ---------------------------------------------------------------------------
// Menu options
// ---------------------------------------------------------------------------

export const CreateOptionSchema = z.object({
  name: z.string().min(1).max(100),
  // Never negative (§24) — enforced here, the authoritative boundary,
  // not just presentation.
  priceDelta: z.number().min(0).default(0),
})
export const UpdateOptionSchema = CreateOptionSchema.partial()

export async function createOption(businessId: string, groupId: string, input: z.infer<typeof CreateOptionSchema>) {
  const validated = CreateOptionSchema.parse(input)
  const group = await prisma.menuOptionGroup.findFirst({ where: { id: groupId, businessId } })
  if (!group) throw new Error('Option group not found')
  const maxSort = await prisma.menuOption.aggregate({ where: { groupId }, _max: { sortOrder: true } })
  return prisma.menuOption.create({
    data: {
      businessId,
      groupId,
      name: validated.name,
      priceDelta: validated.priceDelta,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  })
}

export async function updateOption(businessId: string, optionId: string, input: z.infer<typeof UpdateOptionSchema>) {
  const validated = UpdateOptionSchema.parse(input)
  const option = await prisma.menuOption.findFirst({ where: { id: optionId, businessId } })
  if (!option) throw new Error('Option not found')
  return prisma.menuOption.update({ where: { id: optionId }, data: validated })
}

export async function setOptionActive(businessId: string, optionId: string, isActive: boolean) {
  const option = await prisma.menuOption.findFirst({ where: { id: optionId, businessId } })
  if (!option) throw new Error('Option not found')
  return prisma.menuOption.update({ where: { id: optionId }, data: { isActive } })
}

export async function deleteOption(businessId: string, optionId: string) {
  const option = await prisma.menuOption.findFirst({ where: { id: optionId, businessId } })
  if (!option) throw new Error('Option not found')
  await prisma.menuOption.delete({ where: { id: optionId } })
}

// ---------------------------------------------------------------------------
// Product <-> option group assignment (§6)
// ---------------------------------------------------------------------------

/**
 * Both the product and the group must belong to `businessId` — a crafted
 * request naming another tenant's group (or another tenant's product) is
 * rejected here, the same boundary catalog.service.ts's updateProduct
 * already enforces for productId alone (§20/§25).
 */
export async function assignOptionGroupToProduct(businessId: string, productId: string, groupId: string) {
  const [product, group] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, businessId } }),
    prisma.menuOptionGroup.findFirst({ where: { id: groupId, businessId } }),
  ])
  if (!product) throw new Error('Product not found')
  if (!group) throw new Error('Option group not found')

  const existing = await prisma.productOptionGroup.findUnique({
    where: { productId_groupId: { productId, groupId } },
  })
  if (existing) return existing

  const maxSort = await prisma.productOptionGroup.aggregate({ where: { productId }, _max: { sortOrder: true } })
  return prisma.productOptionGroup.create({
    data: { businessId, productId, groupId, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
  })
}

export async function unassignOptionGroupFromProduct(businessId: string, productId: string, groupId: string) {
  const assignment = await prisma.productOptionGroup.findFirst({ where: { businessId, productId, groupId } })
  if (!assignment) return
  await prisma.productOptionGroup.delete({ where: { id: assignment.id } })
}

/** Reconciles a product's assigned groups to exactly `desiredGroupIds` — assigns any newly-checked group, unassigns any unchecked one, leaves the rest untouched (preserving their sortOrder). Used by the Product editor's "Customer choices" checkbox list (§7). */
export async function syncProductOptionGroups(businessId: string, productId: string, desiredGroupIds: string[]) {
  const desired = new Set(desiredGroupIds)
  const current = await prisma.productOptionGroup.findMany({ where: { businessId, productId } })
  const currentIds = new Set(current.map((a) => a.groupId))

  await Promise.all([
    ...[...desired].filter((id) => !currentIds.has(id)).map((groupId) => assignOptionGroupToProduct(businessId, productId, groupId)),
    ...current.filter((a) => !desired.has(a.groupId)).map((a) => prisma.productOptionGroup.delete({ where: { id: a.id } })),
  ])
}

/** One batched query for the whole catalogue page's "which groups is each product assigned" checkbox defaults — avoids an N+1 per product. */
export async function listAssignedGroupIdsByProduct(businessId: string, productIds: string[]): Promise<Map<string, string[]>> {
  if (productIds.length === 0) return new Map()
  const assignments = await prisma.productOptionGroup.findMany({
    where: { businessId, productId: { in: productIds } },
    orderBy: { sortOrder: 'asc' },
  })
  const byProduct = new Map<string, string[]>()
  for (const a of assignments) {
    byProduct.set(a.productId, [...(byProduct.get(a.productId) ?? []), a.groupId])
  }
  return byProduct
}

/** Owner-facing — every group regardless of isActive, so the editor can show a disabled group as "Inactive" rather than silently omitting it. */
export async function listOptionGroupsForProductOwner(businessId: string, productId: string) {
  const assignments = await prisma.productOptionGroup.findMany({
    where: { businessId, productId },
    orderBy: { sortOrder: 'asc' },
    include: { group: { include: { options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } } } },
  })
  return assignments.map((a) => a.group)
}

export interface PublicMenuOption {
  id: string
  name: string
  /** Decimal string, ZAR — same serialisation convention as PublicProduct.price. */
  priceDelta: string
}

export interface PublicMenuOptionGroup {
  id: string
  name: string
  selectionType: 'SINGLE' | 'MULTIPLE'
  minSelections: number
  maxSelections: number | null
  options: PublicMenuOption[]
}

/**
 * The customer-facing configurator's data source AND the authoritative
 * pricing engine's source of truth (storefront-cart.ts) — active groups and
 * active options only, tenant-scoped through `productId`'s own business
 * ownership. Never trusts anything about a group/option except what's
 * re-fetched here (§12/§13/§25) — a business/product/group/option id
 * belonging to a different tenant simply never appears in the result,
 * exactly like getActiveProduct's own trust boundary.
 */
export async function getActiveOptionGroupsForProduct(businessId: string, productId: string): Promise<PublicMenuOptionGroup[]> {
  const assignments = await prisma.productOptionGroup.findMany({
    where: {
      businessId,
      productId,
      group: { isActive: true },
    },
    orderBy: { sortOrder: 'asc' },
    include: {
      group: {
        include: {
          options: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          },
        },
      },
    },
  })

  return assignments
    .filter((a) => a.group.options.length > 0)
    .map((a) => ({
      id: a.group.id,
      name: a.group.name,
      selectionType: a.group.selectionType,
      minSelections: a.group.minSelections,
      maxSelections: a.group.maxSelections,
      options: a.group.options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta.toString() })),
    }))
}
