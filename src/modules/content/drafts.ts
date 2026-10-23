/**
 * Drafts — the merchant's content, hand-written or AI-written, always
 * copied out and posted by a person. Every read and write is scoped by the
 * actor's business; another business's id is "not found".
 *
 * Permission: canManageContent (owners always). Plan: content_studio for
 * everything here (writing by hand is part of the studio; AI writing is a
 * separate feature checked in generation.ts). A merchant without the plan
 * feature can still run their shop — this module is never on that path.
 */

import { z } from 'zod'
import type { ContentChannel, ContentDraftStatus, ContentDraftType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { assertActorCan, type StaffActor } from '@/lib/auth/guards'
import { assertFeature } from '@/lib/auth/entitlement-guards'
import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import { recordAudit } from '@/modules/platform-admin/audit'
import { ContentError } from './context'

export const DRAFT_SELECT = {
  id: true,
  type: true,
  channel: true,
  title: true,
  content: true,
  status: true,
  sourceType: true,
  sourceId: true,
  campaignId: true,
  plannedFor: true,
  publishedAt: true,
  aiUsageEventId: true,
  createdByStaffId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContentDraftSelect

export type ContentDraftView = Prisma.ContentDraftGetPayload<{ select: typeof DRAFT_SELECT }>

/** Person first, plan second — the same order as every other dashboard gate. */
export async function requireContentStudio(actor: StaffActor, now: Date = new Date()) {
  assertActorCan(actor, 'canManageContent')
  const entitlements = await getBusinessEntitlements(actor.tenantId, now)
  assertFeature(entitlements, 'content_studio')
  return entitlements
}

export async function listDrafts(actor: StaffActor, opts: { status?: ContentDraftStatus; campaignId?: string; take?: number } = {}) {
  await requireContentStudio(actor)
  return prisma.contentDraft.findMany({
    where: { businessId: actor.tenantId, ...(opts.status ? { status: opts.status } : { status: { not: 'ARCHIVED' } }), ...(opts.campaignId ? { campaignId: opts.campaignId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: opts.take ?? 100,
    select: DRAFT_SELECT,
  })
}

export async function getDraft(actor: StaffActor, draftId: string): Promise<ContentDraftView> {
  await requireContentStudio(actor)
  const row = await prisma.contentDraft.findFirst({ where: { id: draftId, businessId: actor.tenantId }, select: DRAFT_SELECT })
  if (!row) throw new ContentError('That draft could not be found.')
  return row
}

export const ManualDraftSchema = z
  .object({
    type: z.enum(['SOCIAL_POST', 'CAPTION', 'STATUS', 'PROMO', 'PRODUCT_DESCRIPTION', 'PRODUCT_TITLE', 'GENERAL']),
    channel: z.enum(['GENERAL', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP_STATUS', 'TIKTOK_CAPTION']).default('GENERAL'),
    title: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(2000),
    campaignId: z.string().min(1).max(64).optional().nullable(),
    plannedFor: z.coerce.date().optional().nullable(),
  })
  .strict()

export async function createManualDraft(actor: StaffActor, raw: unknown): Promise<ContentDraftView> {
  await requireContentStudio(actor)
  const input = ManualDraftSchema.parse(raw)
  if (input.campaignId) {
    const c = await prisma.contentCampaign.findFirst({ where: { id: input.campaignId, businessId: actor.tenantId }, select: { id: true } })
    if (!c) throw new ContentError("That campaign isn't yours.")
  }
  const draft = await prisma.contentDraft.create({
    data: {
      businessId: actor.tenantId,
      createdByStaffId: actor.staffId,
      type: input.type as ContentDraftType,
      channel: input.channel as ContentChannel,
      title: input.title,
      content: input.content,
      sourceType: 'CUSTOM',
      campaignId: input.campaignId ?? null,
      plannedFor: input.plannedFor ?? null,
    },
    select: DRAFT_SELECT,
  })
  await recordAudit({ category: 'MERCHANT_ACTION', action: 'content.draft_created', actor: { type: 'staff', id: actor.staffId }, businessId: actor.tenantId, resource: { type: 'content_draft', id: draft.id }, metadata: { type: input.type, channel: input.channel, source: 'manual' } })
  return draft
}

export const UpdateDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    content: z.string().trim().min(1).max(2000).optional(),
    channel: z.enum(['GENERAL', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP_STATUS', 'TIKTOK_CAPTION']).optional(),
    campaignId: z.string().min(1).max(64).optional().nullable(),
    plannedFor: z.coerce.date().optional().nullable(),
  })
  .strict()

export async function updateDraft(actor: StaffActor, draftId: string, raw: unknown): Promise<ContentDraftView> {
  await requireContentStudio(actor)
  const input = UpdateDraftSchema.parse(raw)
  const existing = await prisma.contentDraft.findFirst({ where: { id: draftId, businessId: actor.tenantId }, select: { id: true, status: true } })
  if (!existing) throw new ContentError('That draft could not be found.')
  if (existing.status === 'ARCHIVED') throw new ContentError('An archived draft cannot be edited — restore it first.')
  if (input.campaignId) {
    const c = await prisma.contentCampaign.findFirst({ where: { id: input.campaignId, businessId: actor.tenantId }, select: { id: true } })
    if (!c) throw new ContentError("That campaign isn't yours.")
  }
  const data: Prisma.ContentDraftUpdateInput = {}
  if (input.title !== undefined) data.title = input.title
  if (input.content !== undefined) data.content = input.content
  if (input.channel !== undefined) data.channel = input.channel as ContentChannel
  if (input.campaignId !== undefined) data.campaign = input.campaignId ? { connect: { id: input.campaignId } } : { disconnect: true }
  if (input.plannedFor !== undefined) data.plannedFor = input.plannedFor
  // Conditional on the business too, so a race with a tenant change can't cross over.
  const r = await prisma.contentDraft.updateMany({ where: { id: draftId, businessId: actor.tenantId }, data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.content !== undefined ? { content: input.content } : {}), ...(input.channel !== undefined ? { channel: input.channel as ContentChannel } : {}), ...(input.campaignId !== undefined ? { campaignId: input.campaignId ?? null } : {}), ...(input.plannedFor !== undefined ? { plannedFor: input.plannedFor } : {}) } })
  if (r.count !== 1) throw new ContentError('That draft could not be found.')
  return getDraft(actor, draftId)
}

const TRANSITIONS: Record<ContentDraftStatus, ContentDraftStatus[]> = {
  DRAFT: ['READY', 'ARCHIVED'],
  READY: ['DRAFT', 'PUBLISHED_MANUALLY', 'ARCHIVED'],
  PUBLISHED_MANUALLY: ['ARCHIVED'],
  ARCHIVED: ['DRAFT'],
}

/** Status is the merchant's own record ("I posted this") — the platform never publishes anything. */
export async function setDraftStatus(actor: StaffActor, draftId: string, status: ContentDraftStatus, now: Date = new Date()): Promise<ContentDraftView> {
  await requireContentStudio(actor)
  const existing = await prisma.contentDraft.findFirst({ where: { id: draftId, businessId: actor.tenantId }, select: { status: true } })
  if (!existing) throw new ContentError('That draft could not be found.')
  if (!TRANSITIONS[existing.status].includes(status)) throw new ContentError(`A ${existing.status.toLowerCase().replace('_', ' ')} draft can't be marked ${status.toLowerCase().replace('_', ' ')}.`)
  const r = await prisma.contentDraft.updateMany({
    where: { id: draftId, businessId: actor.tenantId, status: existing.status },
    data: { status, ...(status === 'PUBLISHED_MANUALLY' ? { publishedAt: now } : {}) },
  })
  if (r.count !== 1) throw new ContentError('That draft changed while you were looking — reload.')
  if (status === 'PUBLISHED_MANUALLY') {
    await recordAudit({ category: 'MERCHANT_ACTION', action: 'content.marked_published', actor: { type: 'staff', id: actor.staffId }, businessId: actor.tenantId, resource: { type: 'content_draft', id: draftId } })
  }
  return getDraft(actor, draftId)
}

/** Upcoming planned content (calendar) — drafts and campaign windows in one list. */
export async function listPlanned(actor: StaffActor, opts: { from?: Date; days?: number } = {}) {
  await requireContentStudio(actor)
  const from = opts.from ?? new Date()
  const to = new Date(from.getTime() + (opts.days ?? 30) * 24 * 60 * 60 * 1000)
  const [drafts, campaigns] = await Promise.all([
    prisma.contentDraft.findMany({
      where: { businessId: actor.tenantId, status: { not: 'ARCHIVED' }, plannedFor: { gte: from, lt: to } },
      orderBy: { plannedFor: 'asc' },
      take: 100,
      select: DRAFT_SELECT,
    }),
    prisma.contentCampaign.findMany({
      where: { businessId: actor.tenantId, status: { in: ['PLANNED', 'ACTIVE'] }, OR: [{ startsAt: { gte: from, lt: to } }, { endsAt: { gte: from, lt: to } }, { AND: [{ startsAt: { lte: from } }, { endsAt: { gte: to } }] }] },
      orderBy: { startsAt: 'asc' },
      take: 50,
      select: { id: true, name: true, goal: true, startsAt: true, endsAt: true, status: true },
    }),
  ])
  return { from, to, drafts, campaigns }
}
