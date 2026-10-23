import { z } from 'zod'
import type { BusinessProfile } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { QUESTIONS, type Answers } from './questions'
import { writeBriefWithFallback } from './onboarding-provider'

/**
 * Business onboarding interview service.
 *
 * Every function here takes `businessId` as its first argument and scopes
 * every query by it — the same tenant-isolation discipline as the rest of
 * modules/ (see lib/testing/tenant-isolation.test.ts). There is no "find
 * profile by id" that isn't also filtered by business.
 *
 * Writes go straight through Prisma: `business_profiles` is an ordinary
 * additive table, not one of the identity tables whose writes CLAUDE.md
 * routes through SECURITY DEFINER RPCs.
 */

/** Answers arrive from a client form, so they're validated, not trusted. */
const AnswerValue = z.union([z.string().max(2000), z.array(z.string().max(200)).max(40)])

const KNOWN_IDS = QUESTIONS.map((q) => q.id)

export const AnswersSchema = z
  .record(z.string(), AnswerValue)
  // Unknown keys are dropped rather than rejected: the question set is
  // expected to change, and a client still running last week's JS bundle
  // shouldn't have its whole submission fail because of one retired id.
  .transform((raw) => {
    const clean: Answers = {}
    for (const id of KNOWN_IDS) {
      if (raw[id] !== undefined) clean[id] = raw[id]
    }
    return clean
  })

export type ProfileView = {
  status: BusinessProfile['status']
  answers: Answers
  currentStep: number
  brief: string | null
  briefSource: BusinessProfile['briefSource']
  skippedAt: Date | null
  completedAt: Date | null
}

function toView(p: BusinessProfile): ProfileView {
  return {
    status: p.status,
    answers: (p.answers ?? {}) as Answers,
    currentStep: p.currentStep,
    brief: p.brief,
    briefSource: p.briefSource,
    skippedAt: p.skippedAt,
    completedAt: p.completedAt,
  }
}

export async function getProfile(businessId: string): Promise<ProfileView | null> {
  const p = await prisma.businessProfile.findUnique({ where: { businessId } })
  return p ? toView(p) : null
}

/**
 * Whether to open the interview dialog on the dashboard right now.
 *
 * Opens for a business with no profile at all (just registered) and for one
 * mid-interview that hasn't been put off. "Remind me later" sets skippedAt,
 * which closes this off and moves the prompt to a card instead — an owner
 * who has said "not now" once shouldn't be asked again by a dialog on every
 * single visit.
 */
export function shouldOpenInterview(profile: ProfileView | null): boolean {
  if (!profile) return true
  if (profile.status !== 'IN_PROGRESS') return false
  return profile.skippedAt === null
}

function clampStep(step: number): number {
  return Number.isFinite(step) ? Math.max(0, Math.min(QUESTIONS.length, step)) : 0
}

/** Saves partial progress so closing the dialog never loses answers. */
export async function saveProgress(
  businessId: string,
  answers: Answers,
  currentStep: number,
): Promise<ProfileView> {
  const step = clampStep(currentStep)
  const p = await prisma.businessProfile.upsert({
    where: { businessId },
    create: { businessId, answers, currentStep: step },
    // Re-opening after "remind me later" clears skippedAt, so the dialog
    // behaves like a resumed interview rather than a permanently dismissed one.
    update: { answers, currentStep: step, skippedAt: null },
  })
  return toView(p)
}

export async function skipInterview(
  businessId: string,
  answers: Answers,
  currentStep: number,
): Promise<void> {
  const step = clampStep(currentStep)
  await prisma.businessProfile.upsert({
    where: { businessId },
    create: { businessId, answers, currentStep: step, skippedAt: new Date() },
    update: { answers, currentStep: step, skippedAt: new Date() },
  })
}

/**
 * Finishes the interview: saves the final answers, writes the storefront
 * brief from them, and marks the profile COMPLETED.
 *
 * The brief is generated and stored here rather than on demand so the
 * storefront generator always has something to read even if the model is
 * unavailable later — and so an owner can sanity-check what we understood
 * about their business immediately, while it's fresh.
 */
export async function completeInterview(
  businessId: string,
  answers: Answers,
): Promise<ProfileView> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, category: true },
  })
  if (!business) throw new Error('Business not found')

  const { brief, source } = await writeBriefWithFallback({
    businessName: business.name,
    category: business.category,
    answers,
    meta: { businessId, staffId: null },
  })

  const data = {
    answers,
    currentStep: QUESTIONS.length,
    status: 'COMPLETED' as const,
    brief,
    briefSource: source === 'model' ? ('MODEL' as const) : ('RULES' as const),
    briefGeneratedAt: new Date(),
    completedAt: new Date(),
    skippedAt: null,
  }

  const p = await prisma.businessProfile.upsert({
    where: { businessId },
    create: { businessId, ...data },
    update: data,
  })
  return toView(p)
}

/** Re-runs brief generation against the answers already on file. */
export async function regenerateBrief(businessId: string): Promise<ProfileView> {
  const existing = await prisma.businessProfile.findUnique({ where: { businessId } })
  if (!existing) throw new Error('No interview answers to build a brief from')
  return completeInterview(businessId, (existing.answers ?? {}) as Answers)
}
