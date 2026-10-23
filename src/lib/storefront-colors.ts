/**
 * Storefront colour/contrast utilities — pure, no Prisma import.
 *
 * These are deliberately independent of the dashboard's `--chalk`/`--ink`
 * tokens (globals.css), which flip value under `prefers-color-scheme` for
 * ANY visitor, including anonymous storefront visitors — a server-computed
 * safe-pair decision against one hardcoded literal would silently be wrong
 * for whichever half of visitors has the other OS preference. A merchant's
 * storefront renders one consistent, deliberate look regardless of the
 * viewer's OS theme, so the two contrast candidates here are fixed literals
 * of their own, not read from or tied to the app's theme system at all.
 */

export interface RGB {
  r: number
  g: number
  b: number
}

export interface SafeColorResult {
  /** The colour actually used as a background — the original hex unless a boundary case forced a nudge. */
  background: string
  /** One of the two fixed storefront text candidates. */
  foreground: string
  ratio: number
  adjusted: boolean
}

/** Warm off-white / near-black — the storefront's own fixed neutral text candidates, not `--chalk`/`--ink`. */
export const STOREFRONT_LIGHT: RGB = { r: 248, g: 245, b: 238 }
export const STOREFRONT_DARK: RGB = { r: 35, g: 32, b: 27 }

/**
 * The storefront's own fixed page chrome (background/text/border), for the
 * same reason as STOREFRONT_LIGHT/DARK above: `--ink`/`--chalk`/`--dust`/
 * `--board`/`--edge` (globals.css) flip under `prefers-color-scheme` for
 * ANY visitor — a storefront reading them directly would visibly change
 * background/text colour depending on a stranger's OS setting, which a
 * merchant's storefront must never do. `PAGE_BG`/`PAGE_FG` are literally
 * STOREFRONT_LIGHT/DARK as hex (the same two neutrals the contrast engine
 * already treats as ground truth); MUTED/BORDER are new fixed literals for
 * secondary text and dividers, verified >=4.5:1 (MUTED) against PAGE_BG.
 */
export const STOREFRONT_PAGE_BG = '#F8F5EE'
export const STOREFRONT_PAGE_FG = '#23201B'
export const STOREFRONT_PAGE_MUTED = '#6B6152'
export const STOREFRONT_PAGE_BORDER = '#E4DCC9'
/** Fixed accent for rating stars/prices — verified 5.02:1 against STOREFRONT_PAGE_BG, not merchant-colour-derived (this was always a generic amber accent, not brand-tied). */
export const STOREFRONT_PAGE_ACCENT = '#9A5A0A'

const DEFAULT_PRIMARY_HEX = '#E8A020'
const MIN_RATIO_NORMAL = 4.5
const MAX_ADJUST_STEPS = 12

/** #RGB / #RRGGBB / #RRGGBBAA (alpha stripped) → {r,g,b}. Anything else (empty, malformed, wrong length) → null, never throws. */
export function parseHexColor(input: string | null | undefined): RGB | null {
  if (!input) return null
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(input.trim())
  if (!match) return null
  let hex = match[1]
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  if (hex.length === 8) hex = hex.slice(0, 6) // drop alpha byte
  const num = parseInt(hex, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function srgbToLinearChannel(c255: number): number {
  const c = c255 / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgbChannel(linear: number): number {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(rgb: RGB): number {
  return (
    0.2126 * srgbToLinearChannel(rgb.r) +
    0.7152 * srgbToLinearChannel(rgb.g) +
    0.0722 * srgbToLinearChannel(rgb.b)
  )
}

/** WCAG contrast ratio, 1 (identical) to 21 (black vs white). Order of arguments doesn't matter. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function toHex(rgb: RGB): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`.toUpperCase()
}

/** Linear-light interpolation (matches the sRGB model relativeLuminance already uses) — not a naive channel average, which would be colorimetrically wrong. */
function lerpTowards(from: RGB, to: RGB, t: number): RGB {
  const mix = (a: number, b: number) => linearToSrgbChannel(srgbToLinearChannel(a) + (srgbToLinearChannel(b) - srgbToLinearChannel(a)) * t)
  return { r: mix(from.r, to.r), g: mix(from.g, to.g), b: mix(from.b, to.b) }
}

/**
 * Given a merchant's chosen colour, returns a background/foreground pair
 * that clears `minRatioNormal` (default WCAG AA 4.5:1) against the
 * storefront's own fixed text candidates. Never renders unreadable text:
 * if the raw colour already clears the threshold against either candidate,
 * it's used as-is (`adjusted:false`). If neither candidate clears it (the
 * narrow mid-tone band where the colour is too close to both), the
 * background is nudged in fixed steps toward whichever of near-black/
 * near-white increases contrast fastest, preserving as much of the
 * original hue/character as the threshold allows rather than snapping
 * straight to a flat neutral. The original hex is never discarded by the
 * caller — this function only decides what's safe for TEXT-bearing
 * surfaces; a non-text usage (e.g. a thin border) can still use the raw
 * brand colour directly.
 */
export function resolveSafePair(hex: string | null | undefined, opts?: { minRatioNormal?: number }): SafeColorResult {
  const minRatio = opts?.minRatioNormal ?? MIN_RATIO_NORMAL
  const base = parseHexColor(hex) ?? parseHexColor(DEFAULT_PRIMARY_HEX)!

  const ratioVsLight = contrastRatio(base, STOREFRONT_LIGHT)
  const ratioVsDark = contrastRatio(base, STOREFRONT_DARK)

  if (ratioVsLight >= minRatio || ratioVsDark >= minRatio) {
    const useLightFg = ratioVsLight >= ratioVsDark
    return {
      background: toHex(base),
      foreground: toHex(useLightFg ? STOREFRONT_LIGHT : STOREFRONT_DARK),
      ratio: useLightFg ? ratioVsLight : ratioVsDark,
      adjusted: false,
    }
  }

  // Neither fixed candidate clears the threshold against the raw colour —
  // nudge the background toward near-black (to pair with the light
  // foreground) and toward near-white (to pair with the dark foreground)
  // in parallel, taking whichever reaches the threshold first.
  for (let step = 1; step <= MAX_ADJUST_STEPS; step++) {
    const t = step / MAX_ADJUST_STEPS
    const towardDark = lerpTowards(base, STOREFRONT_DARK, t)
    const towardLight = lerpTowards(base, STOREFRONT_LIGHT, t)
    const ratioWithLightFg = contrastRatio(towardDark, STOREFRONT_LIGHT)
    const ratioWithDarkFg = contrastRatio(towardLight, STOREFRONT_DARK)

    if (ratioWithLightFg >= minRatio || ratioWithDarkFg >= minRatio) {
      const useLightFg = ratioWithLightFg >= ratioWithDarkFg
      return {
        background: toHex(useLightFg ? towardDark : towardLight),
        foreground: toHex(useLightFg ? STOREFRONT_LIGHT : STOREFRONT_DARK),
        ratio: useLightFg ? ratioWithLightFg : ratioWithDarkFg,
        adjusted: true,
      }
    }
  }

  // Unreachable for any real 8-bit RGB input (step 12 moves fully to the
  // near-black/near-white candidate itself, which always clears against
  // the opposite candidate) — defensive fallback only.
  return {
    background: toHex(STOREFRONT_DARK),
    foreground: toHex(STOREFRONT_LIGHT),
    ratio: contrastRatio(STOREFRONT_DARK, STOREFRONT_LIGHT),
    adjusted: true,
  }
}

export interface StorefrontColorTokens {
  '--store-primary': string
  '--store-primary-safe': string
  '--store-on-primary': string
  '--store-accent': string
  '--store-accent-safe': string
  '--store-on-accent': string
}

/** Composes primary/accent into the full `--store-*` colour token set StorefrontView injects. */
export function buildStorefrontColorTokens(business: {
  primaryColor?: string | null
  accentColor?: string | null
}): StorefrontColorTokens {
  const primary = resolveSafePair(business.primaryColor)
  const accent = resolveSafePair(business.accentColor)
  return {
    '--store-primary': parseHexColor(business.primaryColor) ? toUpper(business.primaryColor!) : DEFAULT_PRIMARY_HEX,
    '--store-primary-safe': primary.background,
    '--store-on-primary': primary.foreground,
    '--store-accent': parseHexColor(business.accentColor) ? toUpper(business.accentColor!) : accent.background,
    '--store-accent-safe': accent.background,
    '--store-on-accent': accent.foreground,
  }
}

function toUpper(hex: string): string {
  return hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`
}
