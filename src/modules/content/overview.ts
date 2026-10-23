/**
 * The Content & Marketing overview: counts, this month's AI usage and a few
 * suggestions. A suggestion is only called evidence-based when it comes
 * from real sales data; the rest are labelled as ideas.
 */

import { prisma } from '@/lib/prisma/client'
import type { StaffActor } from '@/lib/auth/guards'
import { requireContentStudio } from './drafts'
import { salesInsight } from './context'
import { getUsageSummary, type UsageSummary } from './usage'
import { hasFeature } from '@/modules/billing/entitlements'

export interface ContentSuggestion {
  kind: 'POPULAR_PRODUCT' | 'INCOMPLETE_DESCRIPTION' | 'WEEKEND' | 'FIRST_POST'
  title: string
  detail: string
  /** True only when backed by real data (sales, catalogue rows). */
  evidenceBased: boolean
  href: string
}

export interface ContentOverview {
  counts: { drafts: number; ready: number; published: number; campaigns: number; activeCampaigns: number }
  usage: UsageSummary
  canGenerate: boolean
  canCampaign: boolean
  canCalendar: boolean
  suggestions: ContentSuggestion[]
}

export async function getContentOverview(actor: StaffActor, now: Date = new Date()): Promise<ContentOverview> {
  const entitlements = await requireContentStudio(actor, now)
  const businessId = actor.tenantId
  const [drafts, ready, published, campaigns, activeCampaigns, usage, insight, undescribed, anyDraft] = await Promise.all([
    prisma.contentDraft.count({ where: { businessId, status: 'DRAFT' } }),
    prisma.contentDraft.count({ where: { businessId, status: 'READY' } }),
    prisma.contentDraft.count({ where: { businessId, status: 'PUBLISHED_MANUALLY' } }),
    prisma.contentCampaign.count({ where: { businessId, status: { not: 'ARCHIVED' } } }),
    prisma.contentCampaign.count({ where: { businessId, status: 'ACTIVE' } }),
    getUsageSummary(businessId, { entitlements, now }),
    salesInsight(businessId, now),
    prisma.product.findFirst({ where: { businessId, isActive: true, OR: [{ description: null }, { description: '' }] }, orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }], select: { id: true, name: true } }),
    prisma.contentDraft.count({ where: { businessId } }),
  ])

  const suggestions: ContentSuggestion[] = []
  if (insight.topProducts[0]) {
    const top = insight.topProducts[0]
    suggestions.push({ kind: 'POPULAR_PRODUCT', title: `Promote ${top.name}`, detail: `${top.quantity} sold in the last ${insight.days} days — your best seller. A post about it is an easy win.`, evidenceBased: true, href: `/dashboard/content/create?source=INSIGHT&type=SOCIAL_POST` })
  }
  if (undescribed) {
    suggestions.push({ kind: 'INCOMPLETE_DESCRIPTION', title: `Describe ${undescribed.name}`, detail: 'This product has no description on your storefront yet.', evidenceBased: true, href: `/dashboard/content/create?source=PRODUCT&productId=${undescribed.id}&type=PRODUCT_DESCRIPTION` })
  }
  if (anyDraft === 0) {
    suggestions.push({ kind: 'FIRST_POST', title: 'Write your first post', detail: 'Start with a short post introducing the business — an idea, not a measurement.', evidenceBased: false, href: '/dashboard/content/create?source=BUSINESS&type=SOCIAL_POST' })
  }
  suggestions.push({ kind: 'WEEKEND', title: 'Plan weekend content', detail: 'A WhatsApp status on Friday afternoon is a common habit for local shops — an idea, not something measured for your business.', evidenceBased: false, href: '/dashboard/content/create?source=BUSINESS&type=STATUS&channel=WHATSAPP_STATUS' })

  return {
    counts: { drafts, ready, published, campaigns, activeCampaigns },
    usage,
    canGenerate: hasFeature(entitlements, 'content_generation'),
    canCampaign: hasFeature(entitlements, 'content_campaigns'),
    canCalendar: hasFeature(entitlements, 'content_calendar'),
    suggestions: suggestions.slice(0, 3),
  }
}
