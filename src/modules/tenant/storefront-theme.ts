/**
 * Storefront theme configuration — colocated with capabilities.ts,
 * following the exact same pattern: a typed, non-throwing getter and a
 * merge-only setter over `Business.settings` JSON, never a full overwrite.
 *
 * Colours are NOT duplicated here — `Business.primaryColor`/`accentColor`
 * stay the single source of truth (already validated columns, edited via
 * updateBusiness/UpdateBusinessSchema). `settings.storefront` only holds
 * theme DECISIONS that have nowhere else to live. Typography is never
 * stored independently — it's derived from `presetId` only (see
 * storefront-presets.ts), so it can never disagree with the preset.
 */

import type { Prisma, BusinessCategory } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import type { BusinessCapability } from './capabilities'
import { primaryWorkflow, workflowLeadsOverBooking, type WorkflowId } from '@/modules/storefront-workflows/workflows'
import { STYLE_PRESETS, getSurfaceTokens, STOREFRONT_TYPOGRAPHY } from './storefront-presets'
import {
  buildStorefrontColorTokens,
  STOREFRONT_PAGE_BG,
  STOREFRONT_PAGE_FG,
  STOREFRONT_PAGE_MUTED,
  STOREFRONT_PAGE_BORDER,
  STOREFRONT_PAGE_ACCENT,
} from '@/lib/storefront-colors'

export type StorefrontPresetId = 'BOLD' | 'WARM' | 'MODERN' | 'PREMIUM' | 'PLAYFUL' | 'CALM'
export type HeroMode = 'LOGO' | 'COLOUR' | 'IMAGE' | 'MINIMAL'
/** ENQUIRE = the business's primary storefront workflow form (quote, enquiry, pickup or callback — storefront-workflows/workflows.ts). */
export type PrimaryCustomerAction = 'ORDER' | 'BOOK' | 'ENQUIRE' | 'WHATSAPP' | 'CALL' | 'VISIT' | 'BROWSE' | 'LOYALTY'
export type StorefrontSectionEmphasis = 'PRODUCTS' | 'SERVICES' | 'ABOUT' | 'REVIEWS'
export type StorefrontGoal = 'ORDERS' | 'BOOKINGS' | 'ENQUIRIES' | 'WHATSAPP_LEADS' | 'FOOT_TRAFFIC' | 'BRAND_ONLY'
export type StorefrontVoiceTone = 'FRIENDLY' | 'PROFESSIONAL' | 'PLAYFUL' | 'DIRECT'
export type StorefrontSectionId = 'HERO' | 'TRUST_BAR' | 'PRODUCTS' | 'SERVICES' | 'BENEFITS' | 'ABOUT' | 'REVIEWS' | 'CONTACT'

const PRESET_IDS: StorefrontPresetId[] = ['BOLD', 'WARM', 'MODERN', 'PREMIUM', 'PLAYFUL', 'CALM']
const HERO_MODES: HeroMode[] = ['LOGO', 'COLOUR', 'IMAGE', 'MINIMAL']
const PRIMARY_ACTIONS: PrimaryCustomerAction[] = ['ORDER', 'BOOK', 'ENQUIRE', 'WHATSAPP', 'CALL', 'VISIT', 'BROWSE', 'LOYALTY']
const SECTION_EMPHASES: StorefrontSectionEmphasis[] = ['PRODUCTS', 'SERVICES', 'ABOUT', 'REVIEWS']
const GOALS: StorefrontGoal[] = ['ORDERS', 'BOOKINGS', 'ENQUIRIES', 'WHATSAPP_LEADS', 'FOOT_TRAFFIC', 'BRAND_ONLY']
const VOICE_TONES: StorefrontVoiceTone[] = ['FRIENDLY', 'PROFESSIONAL', 'PLAYFUL', 'DIRECT']

export interface StorefrontProfile {
  goal?: StorefrontGoal
  /** The "Feeling" step's answer IS a preset id — one taxonomy, not a second one that can drift. */
  feeling?: StorefrontPresetId
  /** Brand context only — never read by any copy-rendering/legal-text code. */
  voiceTone?: StorefrontVoiceTone
  differentiator?: string
  sectionEmphasis?: StorefrontSectionEmphasis
  interviewCompletedAt?: string
  interviewSkipped?: boolean
}

export interface StorefrontThemeConfig {
  version: 1
  presetId: StorefrontPresetId
  heroMode: HeroMode
  /** undefined = auto-derive from capabilities/contact info, see deriveDefaultPrimaryAction. */
  primaryAction?: PrimaryCustomerAction
}

export interface StorefrontSettings {
  version: 1
  profile: StorefrontProfile
  theme: StorefrontThemeConfig
}

export const DEFAULT_STOREFRONT_THEME: StorefrontThemeConfig = { version: 1, presetId: 'WARM', heroMode: 'MINIMAL' }
const DEFAULT_STOREFRONT_PROFILE: StorefrontProfile = {}

const MAX_DIFFERENTIATOR_LENGTH = 280

/**
 * A sensible STARTING preset per business category — never read once an
 * owner has saved their own choice (sanitizeTheme only falls back to this
 * when theme.presetId is missing/invalid), so it can never override the
 * Storefront Design Wizard. Hero mode is never chosen independently here —
 * it always comes from the picked preset's own `defaultHeroMode`
 * (storefront-presets.ts), the same source a manually-picked preset uses,
 * so a category-derived default and a hand-picked one behave identically.
 * Categories not listed (OTHER and any future addition) fall through to
 * the flat WARM/MINIMAL default, unchanged from before this existed.
 */
const CATEGORY_DEFAULT_PRESET: Partial<Record<BusinessCategory, StorefrontPresetId>> = {
  FOOD_VENDOR: 'WARM',
  SALON: 'PREMIUM',
  HAIR_BRAIDER: 'PREMIUM',
  NAIL_TECHNICIAN: 'PREMIUM',
  RETAIL_STORE: 'MODERN',
  TUCK_SHOP: 'MODERN',
  CAR_WASH: 'BOLD',
  MECHANIC: 'BOLD',
  EVENTS: 'PLAYFUL',
  CHILDCARE: 'CALM',
  LAUNDRY: 'CALM',
}

function getDefaultTheme(category?: BusinessCategory): StorefrontThemeConfig {
  const presetId = (category && CATEGORY_DEFAULT_PRESET[category]) || DEFAULT_STOREFRONT_THEME.presetId
  return { version: 1, presetId, heroMode: STYLE_PRESETS[presetId].defaultHeroMode }
}

function sanitizeTheme(raw: unknown, category?: BusinessCategory): StorefrontThemeConfig {
  const fallback = getDefaultTheme(category)
  if (!raw || typeof raw !== 'object') return fallback
  const theme = (raw as { theme?: unknown }).theme
  if (!theme || typeof theme !== 'object') return fallback
  const t = theme as Partial<StorefrontThemeConfig>
  return {
    version: 1,
    presetId: t.presetId && PRESET_IDS.includes(t.presetId) ? t.presetId : fallback.presetId,
    heroMode: t.heroMode && HERO_MODES.includes(t.heroMode) ? t.heroMode : fallback.heroMode,
    primaryAction: t.primaryAction && PRIMARY_ACTIONS.includes(t.primaryAction) ? t.primaryAction : undefined,
  }
}

function sanitizeProfile(raw: unknown): StorefrontProfile {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STOREFRONT_PROFILE }
  const profile = (raw as { profile?: unknown }).profile
  if (!profile || typeof profile !== 'object') return { ...DEFAULT_STOREFRONT_PROFILE }
  const p = profile as Partial<StorefrontProfile>
  return {
    goal: p.goal && GOALS.includes(p.goal) ? p.goal : undefined,
    feeling: p.feeling && PRESET_IDS.includes(p.feeling) ? p.feeling : undefined,
    voiceTone: p.voiceTone && VOICE_TONES.includes(p.voiceTone) ? p.voiceTone : undefined,
    differentiator: typeof p.differentiator === 'string' ? p.differentiator.trim().slice(0, MAX_DIFFERENTIATOR_LENGTH) || undefined : undefined,
    sectionEmphasis: p.sectionEmphasis && SECTION_EMPHASES.includes(p.sectionEmphasis) ? p.sectionEmphasis : undefined,
    interviewCompletedAt: typeof p.interviewCompletedAt === 'string' ? p.interviewCompletedAt : undefined,
    interviewSkipped: typeof p.interviewSkipped === 'boolean' ? p.interviewSkipped : undefined,
  }
}

/**
 * Never throws — malformed/legacy/missing settings.storefront all resolve
 * to a safe default. `category` is optional so every existing caller that
 * only has `{ settings }` (tests, the profile-only paths) keeps resolving
 * to the flat WARM/MINIMAL default exactly as before; callers that do have
 * the business's category (StorefrontView and friends, which already
 * receive the full `Business` row) get it applied automatically, with zero
 * call-site changes needed beyond this signature.
 */
export function getStorefrontConfig(business: { settings: unknown; category?: BusinessCategory }): StorefrontSettings {
  const settings = (business.settings ?? {}) as { storefront?: unknown }
  return {
    version: 1,
    profile: sanitizeProfile(settings.storefront),
    theme: sanitizeTheme(settings.storefront, business.category),
  }
}

/**
 * Merge-only, mirroring setDeliverySettings's exact read-modify-write
 * pattern — `profile` and `theme` are merged independently so a partial
 * update to one never wipes the other, and every unrelated settings key
 * (capabilities, delivery) survives untouched. Throws on a genuinely
 * invalid enum value; callers should validate user input before calling,
 * but this is the last line of defence against garbage reaching storage.
 */
export async function setStorefrontConfig(
  businessId: string,
  input: { profile?: Partial<StorefrontProfile>; theme?: Partial<StorefrontThemeConfig> },
): Promise<void> {
  if (input.theme?.presetId && !PRESET_IDS.includes(input.theme.presetId)) {
    throw new Error(`Invalid storefront preset: ${input.theme.presetId}`)
  }
  if (input.theme?.heroMode && !HERO_MODES.includes(input.theme.heroMode)) {
    throw new Error(`Invalid hero mode: ${input.theme.heroMode}`)
  }
  if (input.theme?.primaryAction && !PRIMARY_ACTIONS.includes(input.theme.primaryAction)) {
    throw new Error(`Invalid primary action: ${input.theme.primaryAction}`)
  }
  if (input.profile?.goal && !GOALS.includes(input.profile.goal)) {
    throw new Error(`Invalid storefront goal: ${input.profile.goal}`)
  }
  if (input.profile?.feeling && !PRESET_IDS.includes(input.profile.feeling)) {
    throw new Error(`Invalid storefront feeling: ${input.profile.feeling}`)
  }
  if (input.profile?.voiceTone && !VOICE_TONES.includes(input.profile.voiceTone)) {
    throw new Error(`Invalid voice tone: ${input.profile.voiceTone}`)
  }
  if (input.profile?.sectionEmphasis && !SECTION_EMPHASES.includes(input.profile.sectionEmphasis)) {
    throw new Error(`Invalid section emphasis: ${input.profile.sectionEmphasis}`)
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true, category: true } })
  const settings = (business.settings ?? {}) as Record<string, unknown>
  const current = getStorefrontConfig(business)
  const next: StorefrontSettings = {
    version: 1,
    profile: { ...current.profile, ...input.profile },
    theme: { ...current.theme, ...input.theme },
  }
  await prisma.business.update({
    where: { id: businessId },
    data: { settings: { ...settings, storefront: next } as unknown as Prisma.InputJsonValue },
  })
}

/** The one implementation of "never offer ORDER without ORDERS, never BOOK without BOOKINGS" — consumed by both the Customer Actions page and the recommendation engine so this rule can't drift between call sites. */
export function getAvailablePrimaryActions(
  capabilities: Set<BusinessCapability>,
  business: { whatsapp?: string | null; phone?: string | null; address?: string | null; suburb?: string | null; city?: string | null },
  /** Workflows the business can run today (capability AND plan) — the only way ENQUIRE becomes available. */
  workflows: readonly WorkflowId[] = [],
): PrimaryCustomerAction[] {
  const actions: PrimaryCustomerAction[] = []
  if (capabilities.has('PRODUCTS') && capabilities.has('ORDERS')) actions.push('ORDER')
  if (capabilities.has('SERVICES') && capabilities.has('BOOKINGS')) actions.push('BOOK')
  if (workflows.length > 0) actions.push('ENQUIRE')
  if (business.whatsapp) actions.push('WHATSAPP')
  if (business.phone) actions.push('CALL')
  if (business.address || business.suburb || business.city) actions.push('VISIT')
  if (capabilities.has('LOYALTY')) actions.push('LOYALTY')
  actions.push('BROWSE') // always available — browsing the catalogue never requires anything
  return actions
}

/**
 * Never returns an action the business can't actually fulfil — falls
 * through the same priority every merchant would expect. A quote or dated
 * enquiry outranks online booking (a mechanic quotes before it books; an
 * events planner is asked about a date, not a 60-minute slot — see the
 * storefront-websites audit); a pickup or callback sits below booking.
 */
export function deriveDefaultPrimaryAction(
  capabilities: Set<BusinessCapability>,
  business: { whatsapp?: string | null; phone?: string | null; address?: string | null; suburb?: string | null; city?: string | null },
  workflows: readonly WorkflowId[] = [],
): PrimaryCustomerAction {
  const primary = primaryWorkflow(workflows)
  if (capabilities.has('PRODUCTS') && capabilities.has('ORDERS')) return 'ORDER'
  if (primary && workflowLeadsOverBooking(primary)) return 'ENQUIRE'
  if (capabilities.has('SERVICES') && capabilities.has('BOOKINGS')) return 'BOOK'
  if (primary) return 'ENQUIRE'
  if (business.whatsapp) return 'WHATSAPP'
  if (business.phone) return 'CALL'
  if (business.address || business.suburb || business.city) return 'VISIT'
  return 'BROWSE'
}

/**
 * The ONE place a saved `theme.primaryAction` gets validated against what
 * the business can actually fulfil right now, before it's ever rendered.
 * Every caller that needs "what is the merchant's primary action today" —
 * StorefrontView, the recommendation engine, the Customer Actions page —
 * must go through this, not read `theme.primaryAction` directly, so a
 * business whose capabilities or contact info changed AFTER they saved a
 * choice (BOOKINGS turned off, WhatsApp number removed, etc.) can never
 * render a prominent dead CTA. Falls back deterministically via
 * deriveDefaultPrimaryAction, which by construction only ever returns an
 * action already present in `available`.
 */
export function resolvePrimaryAction(
  theme: StorefrontThemeConfig,
  capabilities: Set<BusinessCapability>,
  business: { whatsapp?: string | null; phone?: string | null; address?: string | null; suburb?: string | null; city?: string | null },
  workflows: readonly WorkflowId[] = [],
): PrimaryCustomerAction {
  const available = getAvailablePrimaryActions(capabilities, business, workflows)
  if (theme.primaryAction && available.includes(theme.primaryAction)) return theme.primaryAction
  return deriveDefaultPrimaryAction(capabilities, business, workflows)
}

/**
 * CTA hierarchy, not colour identity: `--store-action-primary` always maps
 * to the primaryColor-derived safe pair and `--store-action-secondary` to
 * the accentColor-derived one (fixed, in resolveStorefrontTokens below) —
 * what changes here is which DOM element (the per-product Order button vs.
 * the per-service Book button) is styled with which token pair, driven by
 * the merchant's actual resolved primary action rather than hardcoded to
 * "Order is always primary because it belongs to PRODUCTS." A product
 * card's Order control does not automatically become the global primary
 * visual action merely because it belongs to PRODUCTS, and likewise for
 * Booking/SERVICES — this is the single source of that rule. Neither
 * Order nor Book is promoted to PRIMARY when the resolved action is
 * something else entirely (WHATSAPP/CALL/VISIT/LOYALTY/BROWSE) — both
 * stay SECONDARY, useful alternative actions, while the dedicated
 * top-of-page CTA (always styled as PRIMARY, see StorefrontView) carries
 * the merchant's actual chosen action.
 */
export function resolveActionEmphasis(
  primaryAction: PrimaryCustomerAction,
): { order: 'primary' | 'secondary'; book: 'primary' | 'secondary' } {
  if (primaryAction === 'ORDER') return { order: 'primary', book: 'secondary' }
  if (primaryAction === 'BOOK') return { order: 'secondary', book: 'primary' }
  return { order: 'secondary', book: 'secondary' }
}

/** IMAGE with no bannerUrl silently resolves to COLOUR — computed once, server-side, never an inline ternary scattered in JSX. */
export function resolveHeroMode(theme: StorefrontThemeConfig, business: { bannerUrl?: string | null }): HeroMode {
  if (theme.heroMode === 'IMAGE' && !business.bannerUrl) return 'COLOUR'
  return theme.heroMode
}

// HERO is structurally fixed-first and CONTACT fixed-last (see StorefrontView) —
// neither is part of these reorderable middle sections. REVIEWS never precedes
// PRODUCTS/SERVICES in either array, so commerce/service controls stay
// discoverable regardless of theme. TRUST_BAR always leads the reorderable
// list (content-dependent — its own renderer returns null when there are no
// real facts to show, same "omit, don't render empty" pattern PRODUCTS/
// SERVICES already use for an empty catalogue). BENEFITS sits beside ABOUT in
// both orders, same reasoning.
const SAFE_SECTION_ORDERS: Record<'COMMERCE_FIRST' | 'STORY_FIRST', StorefrontSectionId[]> = {
  COMMERCE_FIRST: ['TRUST_BAR', 'PRODUCTS', 'SERVICES', 'BENEFITS', 'ABOUT', 'REVIEWS'],
  STORY_FIRST: ['TRUST_BAR', 'BENEFITS', 'ABOUT', 'PRODUCTS', 'SERVICES', 'REVIEWS'],
}

export function resolveSectionOrder(profile: StorefrontProfile): StorefrontSectionId[] {
  return profile.sectionEmphasis === 'ABOUT' ? SAFE_SECTION_ORDERS.STORY_FIRST : SAFE_SECTION_ORDERS.COMMERCE_FIRST
}

/**
 * Composes colour tokens (storefront-colors.ts) + preset typography/spacing/
 * surface tokens into the full `--store-*` map StorefrontView injects on its
 * scoped wrapper.
 *
 * `--store-action-primary`/`--store-action-secondary` (+ their `-foreground`
 * pairs) are semantic CTA-hierarchy tokens, deliberately distinct from
 * `--store-primary`/`--store-accent`: they're a fixed mapping onto the same
 * two safe colour pairs (primary→action-primary, accent→action-secondary —
 * the theme engine's one safe-mapping decision, not persisted anywhere new),
 * while WHICH element on the page gets styled "primary" vs "secondary" is a
 * separate decision (resolveActionEmphasis, driven by the merchant's
 * resolved primaryCustomerAction, not by domain type). Operational/state
 * colours (errors, warnings, success, order-status badges) are never
 * represented here at all — they stay on the app's existing global tokens,
 * completely independent of merchant branding.
 */
export function resolveStorefrontTokens(
  business: { primaryColor?: string | null; accentColor?: string | null },
  config: StorefrontSettings,
): Record<string, string> {
  const preset = STYLE_PRESETS[config.theme.presetId]
  const typography = STOREFRONT_TYPOGRAPHY[preset.typographyId]
  const surface = getSurfaceTokens(preset.surfaceStyle)
  const colors = buildStorefrontColorTokens(business)
  return {
    ...colors,
    '--store-action-primary': colors['--store-primary-safe'],
    '--store-action-primary-foreground': colors['--store-on-primary'],
    '--store-action-secondary': colors['--store-accent-safe'],
    '--store-action-secondary-foreground': colors['--store-on-accent'],
    // Fixed page chrome — never `--chalk`/`--ink`/`--dust`/`--board`/`--edge`,
    // which flip under the viewer's OS theme (see storefront-colors.ts).
    '--store-page-bg': STOREFRONT_PAGE_BG,
    '--store-page-fg': STOREFRONT_PAGE_FG,
    '--store-page-muted': STOREFRONT_PAGE_MUTED,
    '--store-page-border': STOREFRONT_PAGE_BORDER,
    '--store-page-accent': STOREFRONT_PAGE_ACCENT,
    '--store-radius-card': preset.radiusCard,
    '--store-radius-button': preset.radiusButton,
    '--store-space-unit': preset.spaceUnit,
    '--store-card-border-width': surface.borderWidth,
    '--store-card-shadow': surface.shadow,
    '--store-heading-font': `var(${typography.headingFontVar})`,
    '--store-heading-weight': String(typography.headingWeight),
    '--store-heading-letter-spacing': typography.headingLetterSpacing,
    '--store-body-font': `var(${typography.bodyFontVar})`,
  }
}

/**
 * Composes getStorefrontConfig + resolveStorefrontTokens for a route that
 * only needs the token map (the new /about, /gallery, /contact pages, via
 * StorefrontPageShell) — StorefrontView itself still does this inline since
 * it also needs the intermediate `storefrontConfig` for heroMode/
 * sectionOrder/primaryAction, which those simpler pages don't render.
 */
export function resolveStorefrontPageTokens(business: {
  settings: unknown
  category?: BusinessCategory
  primaryColor?: string | null
  accentColor?: string | null
}): Record<string, string> {
  const config = getStorefrontConfig(business)
  return resolveStorefrontTokens(business, config)
}
