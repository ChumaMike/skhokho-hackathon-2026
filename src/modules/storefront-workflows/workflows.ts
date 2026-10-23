/**
 * Storefront workflows beyond "order" and "book" — the ways a customer asks
 * a business for something that isn't a basket or a time slot:
 *
 *   QUOTE_REQUEST     "What would this cost?" with photos (mechanic, events, laundry)
 *   EVENT_ENQUIRY     a date, a headcount and what they need (events, childcare)
 *   PICKUP_REQUEST    "come and fetch it" with an address and a window (laundry, car wash)
 *   CALLBACK_REQUEST  "call me back" or "put me on the waitlist" (salons, anyone)
 *
 * Each workflow is a BusinessCapability (switched on per business, with
 * category defaults in capabilities.ts), is gated by the plan feature
 * `advanced_storefront` (GROW and PRO), renders as a page of the owner's
 * website (pages.ts) and lands in Dashboard › Enquiries as a lead
 * (leads.service.ts). The field lists and schemas here are the single
 * description of each form — the storefront renders them, the API
 * validates with them, the inbox displays with them.
 *
 * Pure: zod + types, no Prisma, no React.
 */

import { z } from 'zod'
import type { BusinessCategory, StorefrontLeadKind } from '@prisma/client'
import type { BusinessCapability } from '@/modules/tenant/capabilities'

export const WORKFLOW_IDS = ['QUOTE_REQUEST', 'EVENT_ENQUIRY', 'PICKUP_REQUEST', 'CALLBACK_REQUEST'] as const
export type WorkflowId = (typeof WORKFLOW_IDS)[number]

/** The plan feature every workflow needs (billing/features.ts). One key, so Tab 4's packaging is untouched. */
export const WORKFLOWS_FEATURE = 'advanced_storefront' as const

export const WORKFLOW_CAPABILITIES = ['QUOTES', 'ENQUIRIES', 'PICKUP_REQUESTS', 'CALLBACKS'] as const satisfies readonly BusinessCapability[]
export type WorkflowCapability = (typeof WORKFLOW_CAPABILITIES)[number]

export const TIME_WINDOWS = ['MORNING', 'AFTERNOON', 'EVENING', 'ANY'] as const
export type TimeWindow = (typeof TIME_WINDOWS)[number]
export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = { MORNING: 'Morning', AFTERNOON: 'Afternoon', EVENING: 'Evening', ANY: 'Any time' }

export const LEAD_LIMITS = {
  name: 80,
  message: 1500,
  short: 160,
  photos: 3,
  headcount: 5000,
} as const

/** The same safe-text rule as the storefront spec: no markup, no links. */
const safe = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !/[<>{}]|javascript:|https?:\/\//i.test(v), 'must not contain markup, braces or links')

const optionalSafe = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[<>{}]|javascript:|https?:\/\//i.test(v), 'must not contain markup, braces or links')
    .transform((v) => (v ? v : undefined))
    .optional()

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'choose a date')

export type FieldType = 'text' | 'textarea' | 'date' | 'number' | 'select'

export interface WorkflowField {
  name: string
  label: string
  type: FieldType
  required: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
  /** Category-specific wording for the same field ("Your vehicle" for a mechanic, "The event" for events). */
  labelByCategory?: Partial<Record<BusinessCategory, string>>
  placeholderByCategory?: Partial<Record<BusinessCategory, string>>
}

export interface WorkflowDefinition {
  id: WorkflowId
  kind: StorefrontLeadKind
  capability: WorkflowCapability
  /** The page's address under the storefront (reserved in pages.ts). */
  slug: string
  /** Page title and nav label. */
  title: string
  /** The main button's words when this workflow is the storefront's primary action. */
  ctaLabel: string
  submitLabel: string
  /** One plain sentence above the form. */
  intro: string
  /** What the owner sees in the inbox: "Quote request". */
  inboxLabel: string
  /** Workflow-specific fields; name, phone, email and message are shared and always present. */
  fields: WorkflowField[]
  photos: boolean
  /** Whether the shared message box is required. */
  messageRequired: boolean
  messageLabel: string
  /** Validates `details` (the workflow-specific fields) — the API's and the inbox's single schema. */
  detailsSchema: z.ZodTypeAny
}

export const WORKFLOWS: Record<WorkflowId, WorkflowDefinition> = {
  QUOTE_REQUEST: {
    id: 'QUOTE_REQUEST',
    kind: 'QUOTE_REQUEST',
    capability: 'QUOTES',
    slug: 'quote',
    title: 'Get a quote',
    ctaLabel: 'Get a quote',
    submitLabel: 'Send quote request',
    intro: 'Tell us what you need and we will come back to you with a price.',
    inboxLabel: 'Quote request',
    fields: [
      {
        name: 'about',
        label: 'What is it for?',
        type: 'text',
        required: false,
        placeholder: 'e.g. 2015 VW Polo, 1.4',
        labelByCategory: { MECHANIC: 'Your vehicle', EVENTS: 'The event', LAUNDRY: 'What needs washing' },
        placeholderByCategory: { MECHANIC: 'e.g. 2015 VW Polo, 1.4', EVENTS: 'e.g. 21st birthday, 60 guests', LAUNDRY: 'e.g. 3 duvets and a load of work clothes' },
      },
      { name: 'preferredDate', label: 'When do you need it by?', type: 'date', required: false },
    ],
    photos: true,
    messageRequired: true,
    messageLabel: 'Describe what you need',
    detailsSchema: z.object({ about: optionalSafe(LEAD_LIMITS.short), preferredDate: isoDate.optional() }).strict(),
  },
  EVENT_ENQUIRY: {
    id: 'EVENT_ENQUIRY',
    kind: 'EVENT_ENQUIRY',
    capability: 'ENQUIRIES',
    slug: 'enquire',
    title: 'Make an enquiry',
    ctaLabel: 'Enquire now',
    submitLabel: 'Send enquiry',
    intro: 'Give us the date and the numbers and we will tell you what we can do.',
    inboxLabel: 'Enquiry',
    fields: [
      { name: 'eventDate', label: 'Date', type: 'date', required: true, labelByCategory: { CHILDCARE: 'Start date' } },
      {
        name: 'headcount',
        label: 'How many people?',
        type: 'number',
        required: true,
        labelByCategory: { CHILDCARE: 'How many children?' },
      },
      {
        name: 'about',
        label: 'What kind of event?',
        type: 'text',
        required: false,
        placeholder: 'e.g. wedding, baby shower, year-end function',
        labelByCategory: { CHILDCARE: "Children's ages" },
        placeholderByCategory: { CHILDCARE: 'e.g. 2 and 4 years old' },
      },
      { name: 'venue', label: 'Where?', type: 'text', required: false, placeholder: 'Venue or area', labelByCategory: { CHILDCARE: 'Days needed' }, placeholderByCategory: { CHILDCARE: 'e.g. Monday to Friday, half days' } },
    ],
    photos: false,
    messageRequired: false,
    messageLabel: 'Anything else we should know?',
    detailsSchema: z
      .object({
        eventDate: isoDate,
        headcount: z.coerce.number().int().min(1).max(LEAD_LIMITS.headcount),
        about: optionalSafe(LEAD_LIMITS.short),
        venue: optionalSafe(LEAD_LIMITS.short),
      })
      .strict(),
  },
  PICKUP_REQUEST: {
    id: 'PICKUP_REQUEST',
    kind: 'PICKUP_REQUEST',
    capability: 'PICKUP_REQUESTS',
    slug: 'pickup',
    title: 'Request a pickup',
    ctaLabel: 'Request a pickup',
    submitLabel: 'Request pickup',
    intro: 'Tell us where and when, and we will confirm on WhatsApp or by phone.',
    inboxLabel: 'Pickup request',
    fields: [
      { name: 'address', label: 'Pickup address', type: 'text', required: true, placeholder: 'Street, suburb' },
      { name: 'preferredDate', label: 'Which day?', type: 'date', required: true },
      {
        name: 'timeWindow',
        label: 'Best time',
        type: 'select',
        required: true,
        options: TIME_WINDOWS.map((value) => ({ value, label: TIME_WINDOW_LABELS[value] })),
      },
      {
        name: 'about',
        label: 'What should we collect?',
        type: 'text',
        required: false,
        placeholder: 'e.g. 2 bags of washing',
        labelByCategory: { CAR_WASH: 'Your vehicle' },
        placeholderByCategory: { CAR_WASH: 'e.g. white Toyota Corolla, CA 123-456' },
      },
    ],
    photos: false,
    messageRequired: false,
    messageLabel: 'Anything else we should know?',
    detailsSchema: z
      .object({
        address: safe(LEAD_LIMITS.short),
        preferredDate: isoDate,
        timeWindow: z.enum(TIME_WINDOWS),
        about: optionalSafe(LEAD_LIMITS.short),
      })
      .strict(),
  },
  CALLBACK_REQUEST: {
    id: 'CALLBACK_REQUEST',
    kind: 'CALLBACK_REQUEST',
    capability: 'CALLBACKS',
    slug: 'callback',
    title: 'Ask us to call you',
    ctaLabel: 'Ask for a call',
    submitLabel: 'Request a call',
    intro: 'Leave your number and the best time, and we will call you back.',
    inboxLabel: 'Callback request',
    fields: [
      {
        name: 'bestTime',
        label: 'Best time to call',
        type: 'select',
        required: true,
        options: TIME_WINDOWS.map((value) => ({ value, label: TIME_WINDOW_LABELS[value] })),
      },
      { name: 'about', label: 'What is it about?', type: 'text', required: false, placeholder: 'e.g. a braiding appointment this weekend' },
    ],
    photos: false,
    messageRequired: false,
    messageLabel: 'Anything else?',
    detailsSchema: z.object({ bestTime: z.enum(TIME_WINDOWS), about: optionalSafe(LEAD_LIMITS.short) }).strict(),
  },
}

export function isWorkflowId(value: unknown): value is WorkflowId {
  return typeof value === 'string' && (WORKFLOW_IDS as readonly string[]).includes(value)
}

export function getWorkflow(id: WorkflowId): WorkflowDefinition {
  return WORKFLOWS[id]
}

export const WORKFLOW_SLUGS: ReadonlySet<string> = new Set(WORKFLOW_IDS.map((id) => WORKFLOWS[id].slug))

export function workflowBySlug(slug: string): WorkflowDefinition | null {
  return WORKFLOW_IDS.map((id) => WORKFLOWS[id]).find((w) => w.slug === slug) ?? null
}

export function workflowByKind(kind: StorefrontLeadKind): WorkflowDefinition {
  return WORKFLOW_IDS.map((id) => WORKFLOWS[id]).find((w) => w.kind === kind)!
}

/** Category-aware label and placeholder for one field. */
export function fieldCopy(field: WorkflowField, category: BusinessCategory): { label: string; placeholder?: string } {
  return {
    label: field.labelByCategory?.[category] ?? field.label,
    placeholder: field.placeholderByCategory?.[category] ?? field.placeholder,
  }
}

/**
 * The workflows a business can run right now: switched on (capability) AND
 * included in its plan. Order is the priority order used when one has to
 * be THE main action: a quote or a dated enquiry is the business's bread
 * and butter; a pickup or a callback is a convenience.
 */
export function activeWorkflows(capabilities: Set<BusinessCapability>, planAllows: boolean): WorkflowId[] {
  if (!planAllows) return []
  return WORKFLOW_IDS.filter((id) => capabilities.has(WORKFLOWS[id].capability))
}

/** Which workflow the storefront's single "enquire" button leads to. */
export function primaryWorkflow(workflows: readonly WorkflowId[]): WorkflowId | null {
  return WORKFLOW_IDS.find((id) => workflows.includes(id)) ?? null
}

/** True when a workflow should outrank online booking as the default main action (see audit: mechanics, events, childcare, laundry). */
export function workflowLeadsOverBooking(id: WorkflowId | null): boolean {
  return id === 'QUOTE_REQUEST' || id === 'EVENT_ENQUIRY'
}

// ---------------------------------------------------------------------------
// A submitted lead
// ---------------------------------------------------------------------------

const saPhone = z
  .string()
  .trim()
  .min(9)
  .max(20)
  .regex(/^[+0-9 ()-]+$/, 'enter a phone number')

/** The shared fields every workflow form posts. */
export const LeadSharedSchema = z
  .object({
    name: safe(LEAD_LIMITS.name),
    phone: saPhone,
    email: z.string().trim().email().max(160).optional().or(z.literal('').transform(() => undefined)),
    message: optionalSafe(LEAD_LIMITS.message),
    serviceName: optionalSafe(LEAD_LIMITS.short),
  })
  .strict()

export type LeadShared = z.infer<typeof LeadSharedSchema>

export interface ParsedLead {
  workflow: WorkflowDefinition
  shared: LeadShared
  details: Record<string, unknown>
}

/**
 * Validates one submission against its workflow. `raw` is a plain object of
 * strings (form fields); details keys outside the workflow's fields are
 * refused by the strict schema.
 */
export function parseLead(workflowId: WorkflowId, raw: Record<string, unknown>): { ok: true; lead: ParsedLead } | { ok: false; error: string } {
  const workflow = WORKFLOWS[workflowId]
  const shared = LeadSharedSchema.safeParse({
    name: raw.name,
    phone: raw.phone,
    email: raw.email ?? '',
    message: raw.message ?? '',
    serviceName: raw.serviceName ?? '',
  })
  if (!shared.success) {
    const field = shared.error.issues[0]?.path[0]
    return { ok: false, error: field === 'phone' ? 'Enter a phone number we can reach you on.' : field === 'email' ? 'That email address doesn’t look right.' : field === 'name' ? 'Tell us your name.' : 'Please check what you typed.' }
  }
  if (workflow.messageRequired && !shared.data.message) return { ok: false, error: `${workflow.messageLabel} before sending.` }

  const detailsInput: Record<string, unknown> = {}
  for (const field of workflow.fields) {
    const value = raw[field.name]
    if (typeof value === 'string' && value.trim() !== '') detailsInput[field.name] = value.trim()
    else if (field.required) return { ok: false, error: `${field.label} is needed.` }
  }
  const details = workflow.detailsSchema.safeParse(detailsInput)
  if (!details.success) {
    const field = details.error.issues[0]?.path[0]
    const def = workflow.fields.find((f) => f.name === field)
    return { ok: false, error: def ? `Check "${def.label}".` : 'Please check what you typed.' }
  }
  return { ok: true, lead: { workflow, shared: shared.data, details: details.data as Record<string, unknown> } }
}

/** Human lines for the inbox and the owner's notification, from a stored details blob. Never throws. */
export function describeLeadDetails(kind: StorefrontLeadKind, category: BusinessCategory, details: unknown): { label: string; value: string }[] {
  const workflow = workflowByKind(kind)
  if (!details || typeof details !== 'object') return []
  const record = details as Record<string, unknown>
  const lines: { label: string; value: string }[] = []
  for (const field of workflow.fields) {
    const value = record[field.name]
    if (value === undefined || value === null || value === '') continue
    const { label } = fieldCopy(field, category)
    if (field.type === 'select' && field.options) {
      lines.push({ label, value: field.options.find((o) => o.value === value)?.label ?? String(value) })
    } else {
      lines.push({ label, value: String(value) })
    }
  }
  return lines
}
