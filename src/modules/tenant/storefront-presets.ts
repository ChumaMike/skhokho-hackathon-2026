/**
 * Storefront style presets — pure data + one pure lookup, no Prisma import.
 *
 * A preset is DATA consumed by shared StorefrontView components, never a
 * branch of markup or a separate storefront implementation. Every CSS
 * Module rule in StorefrontView reads `var(--store-*)` only; it never
 * checks which preset is active.
 *
 * Typography is constrained to the three fonts already loaded app-wide
 * (see src/app/layout.tsx: Archivo, Archivo Black, Space Mono via
 * next/font/google) — no new webfont is downloaded to make six presets
 * look different. EDITORIAL is disclosed honestly as Archivo Black with
 * wide tracking, not a real serif — the true ceiling of "fonts already
 * present" under the no-new-webfont constraint.
 */

import type { StorefrontPresetId, HeroMode, StorefrontSectionEmphasis } from './storefront-theme'

export type TypographyId = 'STRONG' | 'FRIENDLY' | 'CLEAN' | 'EDITORIAL'

export interface TypographyProfile {
  headingFontVar: '--font-display' | '--font-body'
  headingWeight: number
  headingLetterSpacing: string
  bodyFontVar: '--font-body'
}

export const STOREFRONT_TYPOGRAPHY: Record<TypographyId, TypographyProfile> = {
  // Today's exact look — Archivo Black, no extra tracking.
  STRONG: { headingFontVar: '--font-display', headingWeight: 400, headingLetterSpacing: '0', bodyFontVar: '--font-body' },
  CLEAN: { headingFontVar: '--font-body', headingWeight: 600, headingLetterSpacing: '-0.01em', bodyFontVar: '--font-body' },
  FRIENDLY: { headingFontVar: '--font-body', headingWeight: 700, headingLetterSpacing: '0', bodyFontVar: '--font-body' },
  EDITORIAL: { headingFontVar: '--font-display', headingWeight: 400, headingLetterSpacing: '0.06em', bodyFontVar: '--font-body' },
}

export interface StylePreset {
  typographyId: TypographyId
  radiusCard: string
  radiusButton: string
  spaceUnit: string
  surfaceStyle: 'flat' | 'outlined' | 'elevated'
  defaultSectionEmphasis: StorefrontSectionEmphasis
  defaultHeroMode: HeroMode
}

export const STYLE_PRESETS: Record<StorefrontPresetId, StylePreset> = {
  // Numerically exact reproduction of today's hardcoded look — the safe default.
  WARM: { typographyId: 'STRONG', radiusCard: '14px', radiusButton: '10px', spaceUnit: '16px', surfaceStyle: 'outlined', defaultSectionEmphasis: 'PRODUCTS', defaultHeroMode: 'MINIMAL' },
  BOLD: { typographyId: 'STRONG', radiusCard: '4px', radiusButton: '4px', spaceUnit: '12px', surfaceStyle: 'flat', defaultSectionEmphasis: 'PRODUCTS', defaultHeroMode: 'COLOUR' },
  MODERN: { typographyId: 'CLEAN', radiusCard: '10px', radiusButton: '8px', spaceUnit: '16px', surfaceStyle: 'outlined', defaultSectionEmphasis: 'PRODUCTS', defaultHeroMode: 'IMAGE' },
  PREMIUM: { typographyId: 'EDITORIAL', radiusCard: '4px', radiusButton: '4px', spaceUnit: '20px', surfaceStyle: 'flat', defaultSectionEmphasis: 'ABOUT', defaultHeroMode: 'IMAGE' },
  PLAYFUL: { typographyId: 'STRONG', radiusCard: '20px', radiusButton: '20px', spaceUnit: '16px', surfaceStyle: 'elevated', defaultSectionEmphasis: 'PRODUCTS', defaultHeroMode: 'LOGO' },
  CALM: { typographyId: 'FRIENDLY', radiusCard: '12px', radiusButton: '10px', spaceUnit: '20px', surfaceStyle: 'flat', defaultSectionEmphasis: 'ABOUT', defaultHeroMode: 'MINIMAL' },
}

/** User-facing labels for the interview UI. */
export const STOREFRONT_PRESET_LABELS: Record<StorefrontPresetId, string> = {
  BOLD: 'Bold & energetic',
  WARM: 'Warm & local',
  MODERN: 'Clean & modern',
  PREMIUM: 'Premium & elegant',
  PLAYFUL: 'Playful & colourful',
  CALM: 'Natural & calm',
}

const SURFACE_TOKENS: Record<StylePreset['surfaceStyle'], { borderWidth: string; shadow: string }> = {
  flat: { borderWidth: '0px', shadow: 'none' },
  outlined: { borderWidth: '1px', shadow: 'none' },
  elevated: { borderWidth: '0px', shadow: '0 4px 16px rgba(0,0,0,0.12)' },
}

export function getSurfaceTokens(surfaceStyle: StylePreset['surfaceStyle']) {
  return SURFACE_TOKENS[surfaceStyle]
}
