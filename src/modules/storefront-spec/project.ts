/**
 * Spec → live storefront settings. Pure.
 *
 * ONE function decides what a spec means for the stored business, and both
 * sides use it:
 *   - preview: applied in memory to a copy of the business, then handed to
 *     the real live renderer (nothing is written);
 *   - publish: the same projection, written in a transaction.
 * So what a merchant approves in the preview is exactly what customers get.
 *
 * Every unrelated settings key (capabilities, delivery, ordering, payments,
 * a LEGACY design choice) is preserved untouched.
 */

import type { Prisma } from '@prisma/client'
import type { StorefrontContent } from '@/modules/tenant/storefront-content'
import type { StorefrontLayout } from './layout'
import type { SectionLayout } from './layouts'
import type { StorefrontSpec } from './spec'

export interface SpecProjection {
  primaryColor: string
  accentColor: string
  settings: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function projectSpec(currentSettings: unknown, spec: StorefrontSpec, revisionId: string): SpecProjection {
  const settings = isRecord(currentSettings) ? { ...currentSettings } : {}

  const content: StorefrontContent = {
    version: 1,
    hero: { headline: spec.content.heroHeadline, subheadline: spec.content.heroSubline ?? undefined },
    about: { body: spec.content.aboutBody ?? undefined },
    highlights: { items: [...spec.content.highlights] },
    process: (spec.content.process ?? []).map((step) => ({ ...step })),
  }

  // Merge into the existing storefront object rather than replace it, so
  // keys this module doesn't own (e.g. design: 'LEGACY') survive.
  const storefront = isRecord(settings.storefront) ? { ...settings.storefront } : {}
  const profile = isRecord(storefront.profile) ? { ...storefront.profile } : {}
  const theme = isRecord(storefront.theme) ? { ...storefront.theme } : {}

  const layout: StorefrontLayout = {
    version: 1,
    revisionId,
    template: spec.template,
    templateId: spec.templateId ?? null,
    // The spec's superRefine has already checked each layout against the base, so the string is a SectionLayout here.
    sections: spec.home.sections.map((s) => ({ id: s.id, visible: s.visible, ...(s.layout ? { layout: s.layout as SectionLayout } : {}) })),
    cta: { ...spec.cta },
    seo: { ...spec.seo },
  }

  return {
    primaryColor: spec.theme.primaryColor,
    accentColor: spec.theme.accentColor,
    settings: {
      ...settings,
      // Pages only change when the spec carries them; an old revision
      // restored without `site` keeps whatever pages are live today.
      ...(spec.site ? { storefrontPages: { version: 1, pages: structuredClone(spec.site.pages) } } : {}),
      storefrontContent: content,
      storefront: {
        ...storefront,
        version: 1,
        profile: { ...profile, goal: spec.strategy.goal, feeling: spec.theme.presetId },
        theme: {
          version: 1,
          heroMode: typeof theme.heroMode === 'string' ? theme.heroMode : 'MINIMAL',
          ...theme,
          presetId: spec.theme.presetId,
          primaryAction: spec.cta.action,
        },
      },
      storefrontLayout: layout,
    },
  }
}

/** A copy of `business` as it would look with `spec` published — for previews. */
export function withSpecApplied<B extends { settings: Prisma.JsonValue | null; primaryColor: string | null; accentColor: string | null }>(
  business: B,
  spec: StorefrontSpec,
  revisionId: string,
): B {
  const projection = projectSpec(business.settings, spec, revisionId)
  return {
    ...business,
    primaryColor: projection.primaryColor,
    accentColor: projection.accentColor,
    settings: projection.settings as Prisma.JsonValue,
  }
}
