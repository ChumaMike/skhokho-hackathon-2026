/**
 * Per-section layout options — the controlled choices an owner (or the
 * engine) has for how a home section is composed. Every option maps onto
 * a renderer component or a CSS variant that already exists; nothing here
 * is free-form. The spec validates a section's `layout` against this list
 * for the storefront's base (PRODUCT or BOOKING), so a stored layout can
 * never point at a composition the renderer doesn't have.
 *
 * Pure: no Prisma, no React.
 */

import type { HomeSectionId, SpecTemplate } from './spec'
import type { CatalogueDisplay } from './templates'

export const CATALOGUE_LAYOUTS = {
  PRODUCT: ['GRID', 'LIST', 'MENU', 'COLLECTIONS'],
  BOOKING: ['CARDS', 'LIST', 'PORTFOLIO'],
} as const

export const SECTION_LAYOUTS = {
  TRUST_BAR: ['BAR', 'TILES'],
  ABOUT: ['SPLIT', 'STACKED'],
  REVIEWS: ['QUOTE', 'LIST'],
} as const

export type CatalogueLayout = (typeof CATALOGUE_LAYOUTS)[SpecTemplate][number]
export type SectionLayout = CatalogueLayout | (typeof SECTION_LAYOUTS)[keyof typeof SECTION_LAYOUTS][number]

export const LAYOUT_LABELS: Record<SectionLayout, string> = {
  GRID: 'Featured grid',
  LIST: 'Compact list',
  MENU: 'Menu by category',
  COLLECTIONS: 'Collections and featured',
  CARDS: 'Cards with booking',
  PORTFOLIO: 'Portfolio with photos',
  BAR: 'One row',
  TILES: 'Tiles',
  SPLIT: 'Photo beside the story',
  STACKED: 'Photo above the story',
  QUOTE: 'One best quote',
}

/** The layouts a section may take on this base. */
export function allowedLayouts(id: HomeSectionId, template: SpecTemplate): readonly SectionLayout[] {
  if (id === 'CATALOGUE') return CATALOGUE_LAYOUTS[template]
  return SECTION_LAYOUTS[id]
}

export function isLayoutAllowed(id: HomeSectionId, template: SpecTemplate, layout: unknown): layout is SectionLayout {
  return typeof layout === 'string' && (allowedLayouts(id, template) as readonly string[]).includes(layout)
}

/** The catalogue layout a template's composition implies when the section has no explicit layout. */
export function catalogueLayoutFor(display: CatalogueDisplay | null, template: SpecTemplate): CatalogueLayout {
  switch (display) {
    case 'MENU_LIST':
      return 'MENU'
    case 'RETAIL_GRID':
      return 'COLLECTIONS'
    case 'SERVICE_PORTFOLIO':
      return 'PORTFOLIO'
    case 'SERVICE_BOOKING':
    case 'SERVICE_ENQUIRY':
      return 'CARDS'
    default:
      return template === 'BOOKING' ? 'CARDS' : 'GRID'
  }
}

/** Default layout for the other sections — the look every storefront had before layouts existed. */
export function defaultSectionLayout(id: Exclude<HomeSectionId, 'CATALOGUE'>): SectionLayout {
  return SECTION_LAYOUTS[id][0]
}

/** Photo gallery layouts on owner pages (pages.ts GALLERY section). */
export const GALLERY_LAYOUTS = ['GRID', 'PAIRS', 'STRIP'] as const
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number]
export const GALLERY_LAYOUT_LABELS: Record<GalleryLayout, string> = {
  GRID: 'Grid',
  PAIRS: 'Before and after pairs',
  STRIP: 'Wide photos, one after another',
}
