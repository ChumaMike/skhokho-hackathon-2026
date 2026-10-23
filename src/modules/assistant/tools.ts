/**
 * Ask Skhokho's capability layer — the few things the assistant can DO,
 * behind one merchant-facing assistant. Each tool is a plain server
 * function that runs AS the signed-in person: the same permission the
 * matching dashboard page checks, the same plan entitlement the matching
 * feature needs, the same tenant-scoped services. The model (or the rules
 * router) may only REQUEST a tool by name; this registry decides whether it
 * runs. Unknown names, bad input and missing permission all refuse here,
 * whatever the model said.
 *
 * Writes that change the business (applying a product description) are
 * never done by a tool: the tool produces a draft and points at the page
 * where the person previews and confirms (buddy-actions.ts).
 */

import { z } from 'zod'
import type { ContentChannel, ContentDraftType } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { actorCan, type StaffActor } from '@/lib/auth/guards'
import type { StaffPermissions } from '@/types'
import type { BooleanFeature } from '@/modules/billing/features'
import { hasFeature, type Entitlements } from '@/modules/billing/entitlements'
import type { ModelTool } from '@/lib/ai/anthropic'
import { generateContentDraft, CONTENT_TYPES, CHANNELS, TYPE_LABELS } from '@/modules/content/generation'
import { createCampaign, generateCampaignSet } from '@/modules/content/campaigns'
import { salesInsight, ContentError } from '@/modules/content/context'

export interface ToolResult {
  reply: string
  href?: string
}

export interface AssistantTool<I = unknown> {
  name: string
  description: string
  schema: z.ZodType<I, z.ZodTypeDef, unknown>
  /** JSON Schema handed to the model so it can request the tool. */
  inputSchema: Record<string, unknown>
  permission: keyof StaffPermissions
  feature: BooleanFeature
  run(actor: StaffActor, input: I, now: Date): Promise<ToolResult>
}

export class ToolRefusedError extends Error {
  constructor(
    readonly reason: 'UNKNOWN_TOOL' | 'BAD_INPUT' | 'PERMISSION' | 'ENTITLEMENT',
    message: string,
  ) {
    super(message)
    this.name = 'ToolRefusedError'
  }
}

/** Resolves a product the person NAMED to one of THEIR business's products — never an id from the model. */
async function findProductByName(businessId: string, name: string): Promise<{ id: string; name: string } | null> {
  const needle = name.trim()
  if (!needle) return null
  return prisma.product.findFirst({
    where: { businessId, isActive: true, name: { contains: needle, mode: 'insensitive' } },
    orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true },
  })
}

const DraftContentInput = z
  .object({
    type: z.enum(CONTENT_TYPES).default('SOCIAL_POST'),
    channel: z.enum(CHANNELS).default('GENERAL'),
    subject: z.enum(['BUSINESS', 'INSIGHT', 'PRODUCT']).default('BUSINESS'),
    productName: z.string().trim().max(120).optional(),
    goal: z.string().trim().max(200).optional(),
  })
  .strict()

const draftContent: AssistantTool<z.infer<typeof DraftContentInput>> = {
  name: 'draft_content',
  description: 'Write a marketing draft (social post, caption, WhatsApp status, promotion, product description or title) for the business, a named product, or what has been selling. The draft is saved for the person to review; nothing is posted.',
  schema: DraftContentInput,
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...CONTENT_TYPES] },
      channel: { type: 'string', enum: [...CHANNELS] },
      subject: { type: 'string', enum: ['BUSINESS', 'INSIGHT', 'PRODUCT'] },
      productName: { type: 'string', description: 'The product the person named, if any' },
      goal: { type: 'string' },
    },
    additionalProperties: false,
  },
  permission: 'canManageContent',
  feature: 'content_generation',
  async run(actor, input, now) {
    let source: { type: 'BUSINESS' } | { type: 'INSIGHT' } | { type: 'PRODUCT'; productId: string } = { type: input.subject === 'INSIGHT' ? 'INSIGHT' : 'BUSINESS' }
    if (input.subject === 'PRODUCT' || input.productName) {
      const product = await findProductByName(actor.tenantId, input.productName ?? '')
      if (!product) return { reply: `I couldn't find a product called "${input.productName ?? ''}" in your catalogue. Check the name in Catalogue and ask again.`, href: '/dashboard/catalog' }
      source = { type: 'PRODUCT', productId: product.id }
    }
    const draft = await generateContentDraft(actor, { type: input.type, channel: input.channel, source, goal: input.goal }, now)
    return {
      reply: `Here's a ${TYPE_LABELS[draft.type].toLowerCase()} draft:\n\n${draft.content}\n\nIt's saved in Content & Marketing › Drafts — edit it there, mark it ready, and copy it out when you post.`,
      href: `/dashboard/content/drafts/${draft.id}`,
    }
  },
}

const CreateCampaignInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().max(300).optional(),
    productName: z.string().trim().max(120).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    withContent: z.boolean().default(true),
  })
  .strict()

const createCampaignTool: AssistantTool<z.infer<typeof CreateCampaignInput>> = {
  name: 'create_campaign',
  description: 'Create a small marketing campaign (a name, a goal, optionally one product and dates) and, if asked, write the first set of channel versions for it.',
  schema: CreateCampaignInput,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      goal: { type: 'string' },
      productName: { type: 'string' },
      startsAt: { type: 'string', description: 'ISO date-time' },
      endsAt: { type: 'string', description: 'ISO date-time' },
      withContent: { type: 'boolean' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  permission: 'canManageContent',
  feature: 'content_campaigns',
  async run(actor, input, now) {
    const product = input.productName ? await findProductByName(actor.tenantId, input.productName) : null
    const campaign = await createCampaign(actor, { name: input.name, goal: input.goal ?? null, productIds: product ? [product.id] : [], categoryIds: [], startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null }, now)
    let extra = ''
    if (input.withContent) {
      const set = await generateCampaignSet(actor, campaign.id, {}, now)
      extra = set.created.length ? ` I wrote ${set.created.length} version(s) for it (Instagram, Facebook, WhatsApp status, caption).` : ''
      if (set.stopped) extra += ` I stopped early: ${set.stopped}`
    }
    return { reply: `Campaign "${campaign.name}" is set up.${extra} Open it to review and plan the posts.`, href: `/dashboard/content/campaigns/${campaign.id}` }
  },
}

const suggestProducts: AssistantTool<Record<string, never>> = {
  name: 'suggest_products_to_promote',
  description: 'Say which products are worth promoting this week, based only on real paid sales in the last 30 days and products missing a description.',
  schema: z.object({}).strict(),
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  permission: 'canManageContent',
  feature: 'content_studio',
  async run(actor, _input, now) {
    const insight = await salesInsight(actor.tenantId, now)
    const undescribed = await prisma.product.findMany({ where: { businessId: actor.tenantId, isActive: true, OR: [{ description: null }, { description: '' }] }, take: 3, select: { name: true } })
    const lines: string[] = []
    if (insight.topProducts.length) lines.push(`Your best sellers over the last ${insight.days} days: ${insight.topProducts.map((t) => `${t.name} (${t.quantity} sold)`).join(', ')}. Those are the safest things to promote.`)
    else lines.push(`There aren't any paid orders in the last ${insight.days} days yet, so I can't say what's popular — once sales come in I'll use them.`)
    if (undescribed.length) lines.push(`${undescribed.map((p) => p.name).join(', ')} ${undescribed.length === 1 ? 'has' : 'have'} no description on the storefront — worth fixing before promoting.`)
    return { reply: lines.join(' '), href: '/dashboard/content' }
  },
}

export const ASSISTANT_TOOLS: AssistantTool[] = [draftContent as AssistantTool, createCampaignTool as AssistantTool, suggestProducts as AssistantTool]

export function toolDefinitions(): ModelTool[] {
  return ASSISTANT_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
}

/** The only way a tool runs: by name, through the registry, with the person's own permission and plan checked here. */
export async function runTool(actor: StaffActor, entitlements: Entitlements, name: string, rawInput: unknown, now: Date = new Date()): Promise<ToolResult> {
  const tool = ASSISTANT_TOOLS.find((t) => t.name === name)
  if (!tool) throw new ToolRefusedError('UNKNOWN_TOOL', "That isn't something I can do.")
  if (!actorCan(actor, tool.permission)) throw new ToolRefusedError('PERMISSION', "Your role doesn't include marketing content — ask the business owner.")
  if (!hasFeature(entitlements, tool.feature)) throw new ToolRefusedError('ENTITLEMENT', 'Content & Marketing is not included in your plan yet.')
  const parsed = tool.schema.safeParse(rawInput ?? {})
  if (!parsed.success) throw new ToolRefusedError('BAD_INPUT', "I didn't understand enough to do that — try naming the product or the kind of post.")
  try {
    return await tool.run(actor, parsed.data, now)
  } catch (e) {
    if (e instanceof ContentError) return { reply: e.message }
    throw e
  }
}

/**
 * Rules router: plain-language requests that clearly ask for content, so the
 * studio works without an external model. Returns null when unsure — the
 * question then goes to the ordinary answer path, never to a guessed tool.
 */
export function detectContentIntent(question: string): { name: string; input: unknown } | null {
  const q = question.toLowerCase().trim()
  const productName = (() => {
    const m = /(?:for|about|on)\s+(?:my|our|the|this)?\s*(.+?)(?:\s+product)?\s*[.!?]*$/i.exec(question)
    return m ? m[1].trim().slice(0, 120) : undefined
  })()

  if (/\b(which|what)\b.*\b(promote|push|feature|advertise|market)\b/.test(q)) return { name: 'suggest_products_to_promote', input: {} }

  if (/\bcampaign\b/.test(q) && /\b(create|make|set up|start|plan|run)\b/.test(q)) {
    const name = /campaign (?:called|named) ["“]?([^"”]+)["”]?/i.exec(question)?.[1]?.trim() || (/weekend/.test(q) ? 'Weekend campaign' : 'New campaign')
    return { name: 'create_campaign', input: { name: name.slice(0, 120), goal: question.slice(0, 300), productName: /weekend/.test(q) ? undefined : productName, withContent: true } }
  }

  if (/\b(improve|rewrite|better|fix|polish)\b.*\b(description|title|name)\b/.test(q)) {
    const field: ContentDraftType = /\b(title|name)\b/.test(q) ? 'PRODUCT_TITLE' : 'PRODUCT_DESCRIPTION'
    const m = /\b(?:description|title|name)\s+(?:of|for)\s+(?:my|our|the)?\s*(.+?)\s*[.!?]*$/i.exec(question)
    return { name: 'draft_content', input: { type: field, channel: 'GENERAL', subject: 'PRODUCT', productName: m?.[1]?.trim().slice(0, 120) ?? productName } }
  }

  if (/\b(write|create|draft|make|give me|generate)\b.*\b(post|caption|status|statuses|promo|promotion|special|ad|advert|content)\b/.test(q)) {
    let type: ContentDraftType = 'SOCIAL_POST'
    let channel: ContentChannel = 'GENERAL'
    if (/status/.test(q)) {
      type = 'STATUS'
      channel = 'WHATSAPP_STATUS'
    } else if (/caption/.test(q)) type = 'CAPTION'
    else if (/promo|promotion|special|ad\b|advert/.test(q)) type = 'PROMO'
    if (/instagram|insta\b/.test(q)) channel = 'INSTAGRAM'
    else if (/facebook/.test(q)) channel = 'FACEBOOK'
    else if (/tiktok/.test(q)) {
      type = 'CAPTION'
      channel = 'TIKTOK_CAPTION'
    } else if (/whatsapp/.test(q)) channel = 'WHATSAPP_STATUS'
    // "for my shop" / "for the business" / "for us" is not a product name.
    const generic = /^(my|our|the|this)?\s*(shop|business|store|place|us|me|customers?|page|followers|brand)\b/i
    const subject = /\b(best.?sell|popular|selling|top)\b/.test(q) ? 'INSIGHT' : productName && !generic.test(productName) ? 'PRODUCT' : 'BUSINESS'
    return { name: 'draft_content', input: { type, channel, subject, productName: subject === 'PRODUCT' ? productName : undefined, goal: question.slice(0, 200) } }
  }
  return null
}
