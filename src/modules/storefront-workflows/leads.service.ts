/**
 * Leads — what a storefront workflow form produces, and what the business
 * works from in Dashboard › Enquiries. Every read and write is scoped by
 * businessId (the signed session's, or the ACTIVE business the public
 * form named and the host allowed), so one business never sees another's.
 */

import type { Prisma, StorefrontLeadKind, StorefrontLeadStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { sendEmail } from '@/lib/email'
import { registerCustomer } from '@/modules/customers/customer.service'
import { countServerEvent, pageKeyForSlug } from '@/modules/storefront-learning/events'
import { WORKFLOWS, describeLeadDetails, type ParsedLead } from './workflows'

export const LEAD_STATUSES = ['NEW', 'IN_PROGRESS', 'QUOTED', 'WON', 'CLOSED'] as const satisfies readonly StorefrontLeadStatus[]

export const LEAD_STATUS_LABELS: Record<StorefrontLeadStatus, string> = {
  NEW: 'New',
  IN_PROGRESS: 'Busy with it',
  QUOTED: 'Quoted',
  WON: 'Won',
  CLOSED: 'Closed',
}

export const MAX_OWNER_NOTES = 2000

export class LeadNotFoundError extends Error {
  constructor() {
    super('That enquiry could not be found.')
    this.name = 'LeadNotFoundError'
  }
}

const LEAD_SELECT = {
  id: true,
  kind: true,
  status: true,
  membershipId: true,
  customerName: true,
  phone: true,
  email: true,
  message: true,
  details: true,
  photos: true,
  serviceName: true,
  pageSlug: true,
  ownerNotes: true,
  handledAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export type LeadRow = Prisma.StorefrontLeadGetPayload<{ select: typeof LEAD_SELECT }>

/**
 * Saves a validated submission. Registers the phone number as a customer
 * of THIS business (the same pairwise membership path bookings use) so the
 * lead shows against their card; a registration failure never loses the
 * lead. Counts the server-side event and tells the owner, after the save.
 */
export async function createLead(
  businessId: string,
  lead: ParsedLead,
  options: { photos?: string[]; pageSlug?: string; ip?: string } = {},
): Promise<LeadRow> {
  let membershipId: string | null = null
  try {
    const reg = await registerCustomer(businessId, lead.shared.phone, lead.shared.name, `storefront_${lead.workflow.id.toLowerCase()}`, undefined, options.ip)
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM memberships WHERE public_id = ${reg.public_id}::uuid LIMIT 1`
    membershipId = rows[0]?.id ?? null
  } catch (e) {
    console.error('[leads] customer registration failed; saving the lead without a membership', e)
  }

  const row = await prisma.storefrontLead.create({
    data: {
      businessId,
      kind: lead.workflow.kind,
      membershipId,
      customerName: lead.shared.name,
      phone: lead.shared.phone,
      email: lead.shared.email ?? null,
      message: lead.shared.message ?? null,
      details: lead.details as Prisma.InputJsonValue,
      photos: options.photos ?? [],
      serviceName: lead.shared.serviceName ?? null,
      // The page the form was on; a form posted without one is the workflow's own page.
      pageSlug: options.pageSlug || lead.workflow.slug,
    },
    select: LEAD_SELECT,
  })

  // Counted against the page the form was on, so page analytics can show enquiries per page.
  await countServerEvent(businessId, 'LEAD_SUBMITTED', pageKeyForSlug(row.pageSlug))
  await notifyOwner(businessId, row)
  return row
}

/** A dashboard notification plus an email to the owner. Never throws — a failed notification must not fail the customer's request. */
async function notifyOwner(businessId: string, lead: LeadRow): Promise<void> {
  const workflow = WORKFLOWS[workflowIdOf(lead.kind)]
  try {
    await prisma.businessNotification.create({
      data: {
        businessId,
        type: 'new_lead',
        title: `New ${workflow.inboxLabel.toLowerCase()}`,
        message: `${lead.customerName}${lead.serviceName ? ` — ${lead.serviceName}` : ''}`,
        data: { leadId: lead.id, kind: lead.kind },
      },
    })
  } catch (e) {
    console.error('[leads] notification failed', e)
  }
  try {
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, category: true, owner: { select: { email: true } } } })
    if (!business?.owner?.email) return
    const lines = describeLeadDetails(lead.kind, business.category, lead.details)
    const html = [
      `<p>A new ${escapeHtml(workflow.inboxLabel.toLowerCase())} came in on your ${escapeHtml(business.name)} website.</p>`,
      `<p><strong>${escapeHtml(lead.customerName)}</strong><br>${escapeHtml(lead.phone)}${lead.email ? `<br>${escapeHtml(lead.email)}` : ''}</p>`,
      lead.serviceName ? `<p>About: ${escapeHtml(lead.serviceName)}</p>` : '',
      lines.length > 0 ? `<ul>${lines.map((l) => `<li>${escapeHtml(l.label)}: ${escapeHtml(l.value)}</li>`).join('')}</ul>` : '',
      lead.message ? `<p>${escapeHtml(lead.message).replace(/\n/g, '<br>')}</p>` : '',
      lead.photos.length > 0 ? `<p>${lead.photos.length} photo${lead.photos.length === 1 ? '' : 's'} attached — open the enquiry to see them.</p>` : '',
      `<p>Open Dashboard › Enquiries to reply.</p>`,
    ].join('')
    await sendEmail({ to: business.owner.email, subject: `New ${workflow.inboxLabel.toLowerCase()}: ${lead.customerName}`, html, kind: 'owner_new_lead' })
  } catch (e) {
    console.error('[leads] owner email failed', e)
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function workflowIdOf(kind: StorefrontLeadKind) {
  return kind
}

export interface LeadFilters {
  status?: StorefrontLeadStatus | 'OPEN'
  kind?: StorefrontLeadKind
  limit?: number
}

/** The inbox: newest first; OPEN = anything not won or closed. */
export async function listLeads(businessId: string, filters: LeadFilters = {}): Promise<LeadRow[]> {
  const status =
    filters.status === 'OPEN' ? { in: ['NEW', 'IN_PROGRESS', 'QUOTED'] as StorefrontLeadStatus[] } : filters.status ? filters.status : undefined
  return prisma.storefrontLead.findMany({
    where: { businessId, ...(status ? { status } : {}), ...(filters.kind ? { kind: filters.kind } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, filters.limit ?? 100),
    select: LEAD_SELECT,
  })
}

export async function countOpenLeads(businessId: string): Promise<number> {
  return prisma.storefrontLead.count({ where: { businessId, status: { in: ['NEW', 'IN_PROGRESS', 'QUOTED'] } } })
}

export async function getLead(businessId: string, leadId: string): Promise<LeadRow | null> {
  return prisma.storefrontLead.findFirst({ where: { id: leadId, businessId }, select: LEAD_SELECT })
}

export async function setLeadStatus(businessId: string, leadId: string, status: StorefrontLeadStatus): Promise<LeadRow> {
  const updated = await prisma.storefrontLead.updateMany({
    where: { id: leadId, businessId },
    data: { status, handledAt: status === 'NEW' ? null : new Date() },
  })
  if (updated.count === 0) throw new LeadNotFoundError()
  return (await getLead(businessId, leadId))!
}

export async function setLeadNotes(businessId: string, leadId: string, notes: string): Promise<LeadRow> {
  const clean = notes.trim().slice(0, MAX_OWNER_NOTES)
  const updated = await prisma.storefrontLead.updateMany({ where: { id: leadId, businessId }, data: { ownerNotes: clean || null } })
  if (updated.count === 0) throw new LeadNotFoundError()
  return (await getLead(businessId, leadId))!
}

/** A WhatsApp link to the customer with a short opener the owner can edit before sending. */
export function leadWhatsappHref(lead: Pick<LeadRow, 'phone' | 'customerName' | 'kind' | 'serviceName'>, businessName: string): string | null {
  const digits = lead.phone.replace(/[^\d+]/g, '')
  const normalised = digits.startsWith('+') ? digits.slice(1) : digits.startsWith('0') ? `27${digits.slice(1)}` : digits
  if (!/^\d{9,15}$/.test(normalised)) return null
  const what = WORKFLOWS[lead.kind].inboxLabel.toLowerCase()
  const text = `Hi ${lead.customerName}, it's ${businessName}. Thanks for your ${what}${lead.serviceName ? ` about ${lead.serviceName}` : ''}.`
  return `https://wa.me/${normalised}?text=${encodeURIComponent(text)}`
}
