/**
 * The merchant's marketing voice — the small set of things the business
 * record does not already hold. Name, logo, description, contact details,
 * products and the storefront voice tone live where they always did; this
 * only adds audience, personality, phrases and a default call to action,
 * stored under `settings.brand` like every other per-concern setting
 * (src/modules/tenant/capabilities.ts pattern: one reader, one writer).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { getStorefrontConfig, type StorefrontVoiceTone } from '@/modules/tenant/storefront-theme'

export const BrandProfileSchema = z
  .object({
    /** Free text, e.g. "friendly and local, like talking to a neighbour". */
    voice: z.string().trim().max(160).optional().nullable(),
    audience: z.string().trim().max(200).optional().nullable(),
    personality: z.string().trim().max(160).optional().nullable(),
    preferredPhrases: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
    avoidPhrases: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
    defaultCta: z.string().trim().max(80).optional().nullable(),
  })
  .strict()

export type BrandProfileInput = z.infer<typeof BrandProfileSchema>

export interface BrandProfile {
  voice: string | null
  audience: string | null
  personality: string | null
  preferredPhrases: string[]
  avoidPhrases: string[]
  defaultCta: string | null
  /** The storefront's own tone, reused — not a second copy. */
  storefrontVoiceTone: StorefrontVoiceTone | null
}

export function getBrandProfile(business: { settings: unknown }): BrandProfile {
  const raw = ((business.settings ?? {}) as { brand?: unknown }).brand
  const parsed = BrandProfileSchema.safeParse(raw ?? {})
  const b = parsed.success ? parsed.data : BrandProfileSchema.parse({})
  return {
    voice: b.voice ?? null,
    audience: b.audience ?? null,
    personality: b.personality ?? null,
    preferredPhrases: b.preferredPhrases,
    avoidPhrases: b.avoidPhrases,
    defaultCta: b.defaultCta ?? null,
    storefrontVoiceTone: getStorefrontConfig(business).profile.voiceTone ?? null,
  }
}

/** Merges into whatever else lives in `settings`, never replacing other keys. */
export async function setBrandProfile(businessId: string, raw: unknown): Promise<BrandProfile> {
  const input = BrandProfileSchema.parse(raw)
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } })
  const existing = (business.settings ?? {}) as Record<string, unknown>
  const updated = await prisma.business.update({
    where: { id: businessId },
    data: { settings: { ...existing, brand: input } },
    select: { settings: true },
  })
  return getBrandProfile(updated)
}

/** Parses the brand form: comma- or newline-separated phrase lists. */
export function brandProfileFromForm(fd: FormData): BrandProfileInput {
  const text = (k: string) => {
    const v = fd.get(k)
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  const list = (k: string) =>
    (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '')
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)
  return BrandProfileSchema.parse({
    voice: text('voice'),
    audience: text('audience'),
    personality: text('personality'),
    preferredPhrases: list('preferredPhrases'),
    avoidPhrases: list('avoidPhrases'),
    defaultCta: text('defaultCta'),
  })
}
