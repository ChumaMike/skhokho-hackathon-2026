/**
 * PREPARE → CONFIRM → EXECUTE — the only changes the Business Buddy can make.
 *
 *   prepare:  validate → check the person's permission → check the target is
 *             THIS business's → build a preview → store a PREPARED action
 *             (for that person only, expiring after PROPOSAL_TTL_MS)
 *   confirm:  the person sees the preview and taps Apply
 *   execute:  load the action (same business, same person, still PREPARED,
 *             not expired) → re-check permission and target NOW → run the
 *             same service call the dashboard page uses → APPLIED
 *
 * The buddy has no privileges of its own: every check is the one the
 * matching dashboard action makes (see `permission` per kind). Only LOW-risk,
 * reversible, non-customer-facing changes are here. Anything high-risk —
 * publishing a storefront, payment credentials, refunds, cancelling orders,
 * staff changes, buying domains — is deliberately NOT an action kind, so the
 * buddy can only point to the page where a person does it themselves.
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { AuthError, actorCan, type StaffActor } from '@/lib/auth/guards'
import type { StaffPermissions } from '@/types'
import { setProductFeatured, setServiceFeatured } from '@/modules/catalog/catalog.service'
import { generateDraft } from '@/modules/storefront-spec/revision.service'
import { updateProduct } from '@/modules/catalog/catalog.service'
import { recordAudit } from '@/modules/platform-admin/audit'

export const PROPOSAL_TTL_MS = 15 * 60 * 1000

export const BUDDY_ACTION_KINDS = ['FEATURE_ITEM', 'DRAFT_STOREFRONT', 'APPLY_PRODUCT_TEXT'] as const
export type BuddyActionKind = (typeof BUDDY_ACTION_KINDS)[number]

/** Never actions — listed so tests (and readers) can see they're excluded on purpose. */
export const NEVER_BUDDY_ACTIONS = [
  'PUBLISH_STOREFRONT',
  'CHANGE_PAYMENT_CREDENTIALS',
  'REFUND_PAYMENT',
  'CANCEL_ORDER',
  'MANAGE_STAFF',
  'BUY_DOMAIN',
] as const

const FeatureItemParams = z
  .object({
    itemType: z.enum(['PRODUCT', 'SERVICE']),
    itemId: z.string().min(1).max(64),
    featured: z.boolean(),
  })
  .strict()

const DraftStorefrontParams = z.object({ mode: z.enum(['ASSIST', 'GENERATE']) }).strict()

/** A content draft of type PRODUCT_DESCRIPTION / PRODUCT_TITLE, written about one of this business's products. */
const ApplyProductTextParams = z.object({ draftId: z.string().min(1).max(64) }).strict()

export const PrepareRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FEATURE_ITEM'), params: FeatureItemParams }).strict(),
  z.object({ kind: z.literal('DRAFT_STOREFRONT'), params: DraftStorefrontParams }).strict(),
  z.object({ kind: z.literal('APPLY_PRODUCT_TEXT'), params: ApplyProductTextParams }).strict(),
])
export type PrepareRequest = z.infer<typeof PrepareRequestSchema>

export interface ActionPreview {
  title: string
  summary: string
  /** Before → after, in the merchant's terms. */
  changes: { label: string; before: string; after: string }[]
  /** What the person still controls afterwards. */
  note?: string
}

export interface ActionResultView {
  message: string
  href?: string
}

/** The SAME permission the matching dashboard action requires. */
export const ACTION_PERMISSION: Record<BuddyActionKind, keyof StaffPermissions> = {
  FEATURE_ITEM: 'canManageServices', // dashboard/catalog/actions.ts featureItem
  DRAFT_STOREFRONT: 'canManageSettings', // dashboard/storefront/ai/actions.ts
  APPLY_PRODUCT_TEXT: 'canManageServices', // dashboard/catalog/actions.ts updateProduct
}

export class BuddyActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuddyActionError'
  }
}

const NOT_FOUND = "That item isn't in your catalogue any more."

async function loadItem(actor: StaffActor, params: z.infer<typeof FeatureItemParams>) {
  // Scoped by the actor's business — another business's id is simply "not found".
  const where = { id: params.itemId, businessId: actor.tenantId }
  const item =
    params.itemType === 'PRODUCT'
      ? await prisma.product.findFirst({ where, select: { id: true, name: true, isFeatured: true, isActive: true } })
      : await prisma.service.findFirst({ where, select: { id: true, name: true, isFeatured: true, isActive: true } })
  if (!item) throw new BuddyActionError(NOT_FOUND)
  return item
}

/** The draft and its product, both this business's — anything else is "not found". */
async function loadProductText(actor: StaffActor, params: z.infer<typeof ApplyProductTextParams>) {
  const draft = await prisma.contentDraft.findFirst({
    where: { id: params.draftId, businessId: actor.tenantId, type: { in: ['PRODUCT_DESCRIPTION', 'PRODUCT_TITLE'] }, sourceType: 'PRODUCT' },
    select: { id: true, type: true, content: true, sourceId: true, status: true },
  })
  if (!draft || !draft.sourceId) throw new BuddyActionError('That draft could not be found.')
  const product = await prisma.product.findFirst({ where: { id: draft.sourceId, businessId: actor.tenantId }, select: { id: true, name: true, description: true } })
  if (!product) throw new BuddyActionError(NOT_FOUND)
  const field = draft.type === 'PRODUCT_TITLE' ? ('name' as const) : ('description' as const)
  return { draft, product, field }
}

async function featuredNames(actor: StaffActor, itemType: 'PRODUCT' | 'SERVICE'): Promise<string[]> {
  const where = { businessId: actor.tenantId, isActive: true, isFeatured: true }
  const rows =
    itemType === 'PRODUCT'
      ? await prisma.product.findMany({ where, select: { name: true }, orderBy: { name: 'asc' }, take: 6 })
      : await prisma.service.findMany({ where, select: { name: true }, orderBy: { name: 'asc' }, take: 6 })
  return rows.map((r) => r.name)
}

async function buildPreview(actor: StaffActor, request: PrepareRequest): Promise<ActionPreview> {
  switch (request.kind) {
    case 'FEATURE_ITEM': {
      const item = await loadItem(actor, request.params)
      if (!item.isActive) throw new BuddyActionError(`${item.name} is hidden from your storefront — show it again first.`)
      if (item.isFeatured === request.params.featured) {
        throw new BuddyActionError(request.params.featured ? `${item.name} is already featured.` : `${item.name} isn't featured.`)
      }
      const before = await featuredNames(actor, request.params.itemType)
      const after = request.params.featured ? [...before, item.name].sort() : before.filter((n) => n !== item.name)
      return {
        title: request.params.featured ? `Feature ${item.name} on your homepage` : `Stop featuring ${item.name}`,
        summary: request.params.featured
          ? `${item.name} will show in your homepage's featured items and first in your catalogue.`
          : `${item.name} will go back to its normal place in your catalogue.`,
        changes: [{ label: 'Featured on your homepage', before: before.join(', ') || 'Nothing yet', after: after.join(', ') || 'Nothing' }],
        note: 'You can change this any time in Catalogue.',
      }
    }
    case 'APPLY_PRODUCT_TEXT': {
      const { draft, product, field } = await loadProductText(actor, request.params)
      const before = field === 'name' ? product.name : product.description?.trim() || 'No description yet'
      return {
        title: field === 'name' ? `Rename ${product.name}` : `Update the description of ${product.name}`,
        summary: field === 'name' ? 'The product title on your storefront and catalogue will change.' : 'The description shown on your storefront will change.',
        changes: [{ label: field === 'name' ? 'Product title' : 'Description', before, after: draft.content }],
        note: 'You can edit it again any time in Catalogue.',
      }
    }
    case 'DRAFT_STOREFRONT':
      return {
        title: request.params.mode === 'GENERATE' ? 'Draft a new storefront design' : 'Refresh your storefront wording',
        summary:
          request.params.mode === 'GENERATE'
            ? 'Your buddy will draft a storefront design from your business details.'
            : "Your buddy will draft fresh wording for your storefront, keeping today's layout.",
        changes: [{ label: 'Your live storefront', before: 'As it is now', after: 'Unchanged — a draft is saved for you to review' }],
        note: 'Nothing goes live until you review the draft and publish it yourself.',
      }
  }
}

async function execute(actor: StaffActor, request: PrepareRequest): Promise<ActionResultView> {
  switch (request.kind) {
    case 'FEATURE_ITEM': {
      const item = await loadItem(actor, request.params)
      if (request.params.itemType === 'PRODUCT') await setProductFeatured(actor.tenantId, item.id, request.params.featured)
      else await setServiceFeatured(actor.tenantId, item.id, request.params.featured)
      return { message: request.params.featured ? `Done — ${item.name} is now featured.` : `Done — ${item.name} is no longer featured.` }
    }
    case 'DRAFT_STOREFRONT': {
      const draft = await generateDraft(actor.tenantId, actor.staffId, request.params.mode)
      return { message: 'Your draft is ready to review.', href: `/dashboard/storefront/ai/${draft.id}` }
    }
    case 'APPLY_PRODUCT_TEXT': {
      const { draft, product, field } = await loadProductText(actor, request.params)
      // The same validated service the catalogue form uses — generated text never writes a row directly.
      await updateProduct(actor.tenantId, product.id, field === 'name' ? { name: draft.content.slice(0, 200) } : { description: draft.content.slice(0, 2000) })
      await prisma.contentDraft.updateMany({ where: { id: draft.id, businessId: actor.tenantId }, data: { status: 'PUBLISHED_MANUALLY', publishedAt: new Date() } })
      await recordAudit({
        category: 'MERCHANT_ACTION',
        action: field === 'name' ? 'product_title.applied' : 'product_description.applied',
        actor: { type: 'staff', id: actor.staffId },
        businessId: actor.tenantId,
        resource: { type: 'product', id: product.id },
        metadata: { draftId: draft.id, via: 'buddy_action' },
      })
      return { message: field === 'name' ? `Done — ${product.name} is now called ${draft.content}.` : `Done — ${product.name}'s description is updated.`, href: '/dashboard/catalog' }
    }
  }
}

function permissionCheck(actor: StaffActor, kind: BuddyActionKind): void {
  if (!actorCan(actor, ACTION_PERMISSION[kind])) {
    throw new AuthError("Your role doesn't have permission to do that — ask the business owner.", 403)
  }
}

async function record(actor: StaffActor, request: PrepareRequest, data: { status: 'PREPARED' | 'DENIED' | 'FAILED'; preview?: ActionPreview; error?: string }, now: Date) {
  return prisma.buddyAction.create({
    data: {
      businessId: actor.tenantId,
      actorId: actor.staffId,
      actorIsOwner: actor.isOwner,
      kind: request.kind,
      params: request.params as Prisma.InputJsonValue,
      preview: data.preview as unknown as Prisma.InputJsonValue | undefined,
      status: data.status,
      error: data.error ?? null,
      expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
      decidedAt: data.status === 'PREPARED' ? null : now,
    },
    select: { id: true, expiresAt: true },
  })
}

export interface PreparedAction {
  id: string
  kind: BuddyActionKind
  preview: ActionPreview
  expiresAt: Date
}

/** Step 1: check, preview, store. Never changes the business. */
export async function prepareBuddyAction(actor: StaffActor, raw: unknown, now: Date = new Date()): Promise<PreparedAction> {
  const parsed = PrepareRequestSchema.safeParse(raw)
  if (!parsed.success) throw new BuddyActionError("Your buddy can't do that.")
  const request = parsed.data

  try {
    permissionCheck(actor, request.kind)
  } catch (e) {
    await record(actor, request, { status: 'DENIED', error: (e as Error).message }, now)
    throw e
  }
  const preview = await buildPreview(actor, request)
  const row = await record(actor, request, { status: 'PREPARED', preview }, now)
  return { id: row.id, kind: request.kind, preview, expiresAt: row.expiresAt }
}

/** Step 3: the person confirmed. Everything is checked again, now. */
export async function applyBuddyAction(actor: StaffActor, actionId: string, now: Date = new Date()): Promise<ActionResultView> {
  // Same business AND same person — another person's (or business's) action is "not found".
  const row = await prisma.buddyAction.findFirst({ where: { id: actionId, businessId: actor.tenantId, actorId: actor.staffId } })
  if (!row) throw new BuddyActionError('That suggestion could not be found.')
  if (row.status !== 'PREPARED') throw new BuddyActionError('That suggestion has already been dealt with.')
  if (row.expiresAt <= now) {
    await prisma.buddyAction.updateMany({ where: { id: row.id, status: 'PREPARED' }, data: { status: 'EXPIRED', decidedAt: now } })
    throw new BuddyActionError('That preview has expired — open it again to see the latest.')
  }

  const parsed = PrepareRequestSchema.safeParse({ kind: row.kind, params: row.params })
  if (!parsed.success) throw new BuddyActionError("Your buddy can't do that.")
  const request = parsed.data

  // Claim it first, so a double-tap can't apply it twice.
  const claimed = await prisma.buddyAction.updateMany({ where: { id: row.id, status: 'PREPARED' }, data: { status: 'APPLIED', decidedAt: now } })
  if (claimed.count === 0) throw new BuddyActionError('That suggestion has already been dealt with.')

  try {
    permissionCheck(actor, request.kind)
  } catch (e) {
    await prisma.buddyAction.update({ where: { id: row.id }, data: { status: 'DENIED', error: (e as Error).message } })
    throw e
  }
  try {
    return await execute(actor, request)
  } catch (e) {
    // Errors written for merchants (ours, and the draft engine's daily limit) are shown as they are.
    const message =
      e instanceof BuddyActionError || (e instanceof Error && e.name === 'GenerationLimitError')
        ? e.message
        : 'Something went wrong — nothing was changed.'
    await prisma.buddyAction.update({ where: { id: row.id }, data: { status: 'FAILED', error: message } })
    if (message.startsWith('Something went wrong')) console.error('[buddy] action failed', row.kind, e)
    throw new BuddyActionError(message)
  }
}

/** "Not now". */
export async function cancelBuddyAction(actor: StaffActor, actionId: string, now: Date = new Date()): Promise<void> {
  await prisma.buddyAction.updateMany({
    where: { id: actionId, businessId: actor.tenantId, actorId: actor.staffId, status: 'PREPARED' },
    data: { status: 'CANCELLED', decidedAt: now },
  })
}
