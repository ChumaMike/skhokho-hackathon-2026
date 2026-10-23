/**
 * Applying a platform-APPROVED pattern to a new storefront draft. Pure — no
 * database — so the planner/copywriter can use it without pulling in the
 * learning pipeline.
 *
 * A pattern only ever nudges STRUCTURE (section order, main action), and only
 * within what this business can actually do: a section the business has no
 * content for stays hidden, a required section stays shown, and an action the
 * planner didn't allow is ignored. Validation still runs afterwards as usual.
 */

import type { HomeSectionId, StorefrontSpec } from '@/modules/storefront-spec/spec'
import type { PrimaryCustomerAction } from '@/modules/tenant/storefront-theme'

export interface PatternShape {
  vertical: string
  templateId: string | null
  /** Visible home sections, in order. */
  sections: HomeSectionId[]
  ctaAction: PrimaryCustomerAction
}

export function applyLearnedPattern(
  spec: StorefrontSpec,
  pattern: PatternShape | null,
  allowedActions: readonly PrimaryCustomerAction[],
  ctaLabelFor: (action: PrimaryCustomerAction) => string,
): StorefrontSpec {
  if (!pattern) return spec
  if (pattern.vertical !== spec.strategy.vertical || (pattern.templateId ?? null) !== (spec.templateId ?? null)) return spec

  const next = structuredClone(spec)
  const current = new Map(next.home.sections.map((s) => [s.id, s.visible]))
  const ordered = [
    ...pattern.sections.filter((id) => current.has(id)),
    ...next.home.sections.map((s) => s.id).filter((id) => !pattern.sections.includes(id)),
  ]
  // Order changes; visibility is the business's own (what it has content for).
  next.home.sections = ordered.map((id) => ({ id, visible: current.get(id)! }))

  if (pattern.ctaAction !== next.cta.action && allowedActions.includes(pattern.ctaAction)) {
    next.cta = { action: pattern.ctaAction, label: ctaLabelFor(pattern.ctaAction) }
  }
  return next
}

/** One line for the AI prompt — structure only, never another business's words. */
export function patternHint(pattern: PatternShape | null): string | null {
  if (!pattern) return null
  return `A layout platform reviewers have approved for similar businesses: sections in this order — ${pattern.sections.join(', ')}; main action ${pattern.ctaAction}. Prefer it unless this business's details suggest otherwise.`
}
