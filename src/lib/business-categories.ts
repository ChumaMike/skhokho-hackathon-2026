import type { BusinessCategory } from '@prisma/client'

/** Shared with /join (business self-registration) and /discover (customer search). */
export const BUSINESS_CATEGORIES: [BusinessCategory, string][] = [
  ['SALON', 'Salon / Hair'],
  ['FOOD_VENDOR', 'Food / Takeaway'],
  ['CAR_WASH', 'Car Wash'],
  ['RETAIL_STORE', 'Shop / Retail'],
  ['TUCK_SHOP', 'Spaza / Tuck Shop'],
  ['MECHANIC', 'Mechanic'],
  ['HAIR_BRAIDER', 'Hair Braider'],
  ['NAIL_TECHNICIAN', 'Nails'],
  ['EVENTS', 'Events'],
  ['CHILDCARE', 'Childcare'],
  ['LAUNDRY', 'Laundry'],
  ['OTHER', 'Something else'],
]

export function categoryLabel(category: BusinessCategory): string {
  return BUSINESS_CATEGORIES.find(([id]) => id === category)?.[1] ?? category
}
