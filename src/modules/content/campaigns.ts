/**
 * Lightweight campaigns: a name, a goal, what they promote and when. They
 * group drafts; no ad buying, no account integrations, nothing is posted.
 * Plan: content_campaigns (feature) + content_campaigns_monthly (limit on
 * how many may be created per calendar month).
 */

import { z } from 'zod'
import type { ContentCampaignStatus, ContentChannel, ContentDraftType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { assertActorCan, type StaffActor } from '@/lib/auth/guards'
import { assertFeature } from '@/lib/auth/entitlement-guards'
import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import { featureLimit } from '@/modules/billing/entitlements'
import { recordAudit } from '@/modules/platform-admin/audit'
import { AiCallError, monthWindow } from '@/lib/ai/anthropic'
import { ContentError } from './context'
import { generateContentDraft } from './generation'
import { DRAFT_SELECT, type ContentDraftView } from './drafts'

export const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  goal: true,
  productIds: true,
  categoryIds: true,
  startsAt: true,
  endsAt: true,
  notes: true,
  status: true,
  createdByStaffId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { drafts: true } },
} satisfies Prisma.ContentCampaignSelect
export type ContentCampaignView = Prisma.ContentCampaignGetPayload<{ select: typeof CAMPAIGN_SELECT }>

export const CampaignInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().max(300).optional().nullable(),
    productIds: z.array(z.string().min(1).max(64)).max(20).default([]),
    categoryIds: z.array(z.string().min(1).max(64)).max(10).default([]),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .strict()
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt >= v.startsAt, { message: 'The end date must be after the start date.', path: ['endsAt'] })

async function requireCampaigns(actor: StaffActor, now: Date) {
  assertActorCan(actor, 'canManageContent')
  const entitlements = await getBusinessEntitlements(actor.tenantId, now)
  assertFeature(entitlements, 'content_campaigns')
  return entitlements
}

/** Only this business's active products / categories survive — foreign ids are dropped, never trusted. */
async function ownedIds(businessId: string, productIds: string[], categoryIds: string[]) {
  const [products, categories] = await Promise.all([
    productIds.length ? prisma.product.findMany({ where: { businessId, id: { in: productIds }, isActive: true }, select: { id: true } }) : [],
    categoryIds.length ? prisma.productCategory.findMany({ where: { businessId, id: { in: categoryIds } }, select: { id: true } }) : [],
  ])
  return { productIds: products.map((p) => p.id), categoryIds: categories.map((c) => c.id) }
}

export async function listCampaigns(actor: StaffActor, opts: { includeArchived?: boolean } = {}) {
  await requireCampaigns(actor, new Date())
  return prisma.contentCampaign.findMany({
    where: { businessId: actor.tenantId, ...(opts.includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
    orderBy: [{ status: 'asc' }, { startsAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    select: CAMPAIGN_SELECT,
  })
}

export async function getCampaign(actor: StaffActor, campaignId: string): Promise<ContentCampaignView & { drafts: ContentDraftView[] }> {
  await requireCampaigns(actor, new Date())
  const row = await prisma.contentCampaign.findFirst({ where: { id: campaignId, businessId: actor.tenantId }, select: { ...CAMPAIGN_SELECT, drafts: { orderBy: { createdAt: 'asc' }, select: DRAFT_SELECT } } })
  if (!row) throw new ContentError('That campaign could not be found.')
  return row
}

export async function createCampaign(actor: StaffActor, raw: unknown, now: Date = new Date()): Promise<ContentCampaignView> {
  const entitlements = await requireCampaigns(actor, now)
  const input = CampaignInputSchema.parse(raw)
  const limit = featureLimit(entitlements, 'content_campaigns_monthly')
  if (limit !== null) {
    const { start, end } = monthWindow(now)
    const used = await prisma.contentCampaign.count({ where: { businessId: actor.tenantId, createdAt: { gte: start, lt: end } } })
    if (used >= limit) throw new ContentError(limit === 0 ? 'Campaigns are not included in your plan.' : `You have created all ${limit} campaigns your plan allows this month.`)
  }
  const ids = await ownedIds(actor.tenantId, input.productIds, input.categoryIds)
  const campaign = await prisma.contentCampaign.create({
    data: { businessId: actor.tenantId, createdByStaffId: actor.staffId, name: input.name, goal: input.goal ?? null, notes: input.notes ?? null, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, ...ids },
    select: CAMPAIGN_SELECT,
  })
  await recordAudit({ category: 'MERCHANT_ACTION', action: 'campaign.created', actor: { type: 'staff', id: actor.staffId }, businessId: actor.tenantId, resource: { type: 'content_campaign', id: campaign.id }, metadata: { products: ids.productIds.length, categories: ids.categoryIds.length } })
  return campaign
}

export async function updateCampaign(actor: StaffActor, campaignId: string, raw: unknown, now: Date = new Date()): Promise<ContentCampaignView> {
  await requireCampaigns(actor, now)
  const input = CampaignInputSchema.parse(raw)
  const ids = await ownedIds(actor.tenantId, input.productIds, input.categoryIds)
  const r = await prisma.contentCampaign.updateMany({
    where: { id: campaignId, businessId: actor.tenantId, status: { not: 'ARCHIVED' } },
    data: { name: input.name, goal: input.goal ?? null, notes: input.notes ?? null, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, ...ids },
  })
  if (r.count !== 1) throw new ContentError('That campaign could not be found.')
  return getCampaign(actor, campaignId)
}

const TRANSITIONS: Record<ContentCampaignStatus, ContentCampaignStatus[]> = {
  PLANNED: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: ['PLANNED'],
}

export async function setCampaignStatus(actor: StaffActor, campaignId: string, status: ContentCampaignStatus): Promise<ContentCampaignView> {
  await requireCampaigns(actor, new Date())
  const existing = await prisma.contentCampaign.findFirst({ where: { id: campaignId, businessId: actor.tenantId }, select: { status: true } })
  if (!existing) throw new ContentError('That campaign could not be found.')
  if (!TRANSITIONS[existing.status].includes(status)) throw new ContentError(`A ${existing.status.toLowerCase()} campaign can't be marked ${status.toLowerCase()}.`)
  const r = await prisma.contentCampaign.updateMany({ where: { id: campaignId, businessId: actor.tenantId, status: existing.status }, data: { status } })
  if (r.count !== 1) throw new ContentError('That campaign changed while you were looking — reload.')
  return getCampaign(actor, campaignId)
}

/** One campaign → several channel versions, each its own metered generation. Stops cleanly when the allowance runs out. */
export const CAMPAIGN_SET: { type: ContentDraftType; channel: ContentChannel }[] = [
  { type: 'SOCIAL_POST', channel: 'INSTAGRAM' },
  { type: 'SOCIAL_POST', channel: 'FACEBOOK' },
  { type: 'STATUS', channel: 'WHATSAPP_STATUS' },
  { type: 'CAPTION', channel: 'GENERAL' },
]

export async function generateCampaignSet(actor: StaffActor, campaignId: string, opts: { channels?: ContentChannel[]; requestKey?: string } = {}, now: Date = new Date()) {
  await requireCampaigns(actor, now)
  const campaign = await prisma.contentCampaign.findFirst({ where: { id: campaignId, businessId: actor.tenantId }, select: { id: true, name: true, goal: true, productIds: true, categoryIds: true } })
  if (!campaign) throw new ContentError('That campaign could not be found.')
  const source = campaign.productIds[0] ? ({ type: 'PRODUCT', productId: campaign.productIds[0] } as const) : campaign.categoryIds[0] ? ({ type: 'CATEGORY', categoryId: campaign.categoryIds[0] } as const) : ({ type: 'BUSINESS' } as const)
  const wanted = CAMPAIGN_SET.filter((c) => !opts.channels || opts.channels.includes(c.channel))
  const created: ContentDraftView[] = []
  let stopped: string | null = null
  for (const [i, c] of wanted.entries()) {
    try {
      created.push(
        await generateContentDraft(
          actor,
          { type: c.type, channel: c.channel, source, goal: campaign.goal ?? `Campaign: ${campaign.name}`, campaignId: campaign.id, requestKey: opts.requestKey ? `${opts.requestKey}:${i}` : undefined },
          now,
        ),
      )
    } catch (e) {
      stopped = e instanceof AiCallError || e instanceof ContentError ? e.message : 'Something went wrong writing one of the versions.'
      break
    }
  }
  return { created, stopped }
}
