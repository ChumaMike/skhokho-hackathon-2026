/**
 * The ONE path to the external model. Every AI feature calls `callModel`;
 * nothing else in the app may fetch the provider.
 *
 * In order, every call:
 *   1. is refused unless the platform switch is on (externalAiEnabled);
 *   2. is refused unless the business's plan grants the feature and its
 *      monthly generation allowance (and token budget, if any) has room;
 *   3. is refused if the person is over the per-person abuse rate limit;
 *   4. runs with a hard timeout;
 *   5. is RECORDED as an AiUsageEvent either way — who, which capability,
 *      model, tokens, estimated cost, outcome — never the prompt or answer.
 *
 * Refusals are thrown as AiCallError with a `code` callers can show or
 * fall back on (rules providers). A refused call costs nothing and is still
 * recorded, so "blocked by allowance" is visible in the Control Centre.
 */

import type { AiUsageOutcome, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { checkRateLimits } from '@/lib/rate-limit'
import { log, errorFields } from '@/lib/log'
import { externalAiEnabled } from './external-ai'
import { estimateCostUsdMicros } from './pricing'
import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import { featureLimit, hasFeature, type Entitlements } from '@/modules/billing/entitlements'
import type { BooleanFeature } from '@/modules/billing/features'

export const DEFAULT_MODEL = 'claude-sonnet-5'
export const DEFAULT_TIMEOUT_MS = 15_000

export type AiCallCode = 'DISABLED' | 'ENTITLEMENT' | 'ALLOWANCE' | 'RATE_LIMIT' | 'PROVIDER' | 'TIMEOUT' | 'DUPLICATE'

export class AiCallError extends Error {
  constructor(
    readonly code: AiCallCode,
    message: string,
  ) {
    super(message)
    this.name = 'AiCallError'
  }
}

export interface ModelTool {
  name: string
  description: string
  /** JSON Schema for the tool's input. */
  input_schema: Record<string, unknown>
}

export interface ModelMessage {
  role: 'user' | 'assistant'
  content: string | Array<Record<string, unknown>>
}

export interface ModelCall {
  /** The plan feature this call runs under — checked against the business's entitlements. */
  feature: BooleanFeature
  /** Internal capability name for accounting (e.g. 'content.social_post', 'assistant.chat'). */
  capability: string
  /** The business paying for the call; null only for pre-business calls (signup classifier). */
  businessId: string | null
  actor: { type: 'STAFF'; id: string } | { type: 'SYSTEM' }
  system: string
  messages: ModelMessage[]
  maxTokens: number
  model?: string
  timeoutMs?: number
  tools?: ModelTool[]
  /** False for platform-internal calls that must not count against the merchant (default true when businessId is set). */
  metered?: boolean
  /** A retried request with the same key is refused rather than charged twice. */
  idempotencyKey?: string
  /** Pre-resolved entitlements, to avoid a second read when the caller already has them. */
  entitlements?: Entitlements
}

/** Who a call is for — threaded through providers that used to know nothing about the caller. */
export interface AiMeta {
  businessId: string | null
  staffId: string | null
}

export function actorFrom(meta: AiMeta | undefined): ModelCall['actor'] {
  return meta?.staffId ? { type: 'STAFF', id: meta.staffId } : { type: 'SYSTEM' }
}

export interface ModelResult {
  text: string
  toolUses: { id: string; name: string; input: unknown }[]
  usage: { inputTokens: number; outputTokens: number }
  model: string
  stopReason: string | null
  usageEventId: string | null
}

/** The raw provider transport — replaceable in tests so no test ever reaches the network. */
export type ModelTransport = (body: Record<string, unknown>, timeoutMs: number) => Promise<ProviderResponse>

export interface ProviderResponse {
  content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>
  usage?: { input_tokens?: number; output_tokens?: number }
  stop_reason?: string | null
  model?: string
}

let transport: ModelTransport = async (body, timeoutMs) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new AiCallError('DISABLED', 'External AI is switched off.')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new AiCallError('PROVIDER', `Model request failed (${res.status})`)
  return (await res.json()) as ProviderResponse
}

export function __setModelTransportForTests(fn: ModelTransport | null): void {
  transport = fn ?? defaultTransportRef
}
const defaultTransportRef = transport

/** Calendar-month window in South African time (UTC+2, no DST). */
export function monthWindow(now: Date = new Date()): { start: Date; end: Date } {
  const SAST = 2 * 60 * 60 * 1000
  const local = new Date(now.getTime() + SAST)
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - SAST)
  const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - SAST)
  return { start, end }
}

export interface AllowanceState {
  generationsUsed: number
  /** null = unlimited; 0 = not granted */
  generationsLimit: number | null
  tokensUsed: number
  tokenBudget: number | null
}

/** This month's metered usage for a business against its plan. */
export async function allowanceFor(businessId: string, entitlements: Entitlements, now: Date = new Date()): Promise<AllowanceState> {
  const { start, end } = monthWindow(now)
  const agg = await prisma.aiUsageEvent.aggregate({
    where: { businessId, metered: true, outcome: 'OK', createdAt: { gte: start, lt: end } },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true },
  })
  const budgetGrant = entitlements.features.ai_token_budget_monthly
  return {
    generationsUsed: agg._count._all,
    generationsLimit: featureLimit(entitlements, 'ai_generations_monthly'),
    tokensUsed: (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0),
    tokenBudget: budgetGrant.enabled ? budgetGrant.limit : null,
  }
}

async function record(call: ModelCall, data: { outcome: AiUsageOutcome; model: string; inputTokens?: number; outputTokens?: number; durationMs?: number; errorClass?: string }): Promise<string | null> {
  try {
    const row = await prisma.aiUsageEvent.create({
      data: {
        businessId: call.businessId,
        actorType: call.actor.type,
        actorId: call.actor.type === 'STAFF' ? call.actor.id : null,
        feature: call.feature,
        capability: call.capability,
        metered: call.metered ?? call.businessId !== null,
        model: data.model,
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        estimatedCostUsdMicros: data.outcome === 'OK' ? estimateCostUsdMicros(data.model, data.inputTokens ?? 0, data.outputTokens ?? 0) : null,
        outcome: data.outcome,
        durationMs: data.durationMs ?? null,
        errorClass: data.errorClass ?? null,
        idempotencyKey: call.idempotencyKey ?? null,
      } satisfies Prisma.AiUsageEventUncheckedCreateInput,
      select: { id: true },
    })
    return row.id
  } catch (e) {
    // Accounting must never take the feature down, but a missing row is a signal.
    log('error', 'ai.usage_record_failed', { capability: call.capability, businessId: call.businessId, ...errorFields(e) })
    return null
  }
}

export async function callModel(call: ModelCall, now: Date = new Date()): Promise<ModelResult> {
  const model = call.model ?? DEFAULT_MODEL
  const refuse = async (outcome: AiUsageOutcome, code: AiCallCode, message: string): Promise<never> => {
    await record(call, { outcome, model })
    throw new AiCallError(code, message)
  }

  if (call.idempotencyKey) {
    const dup = await prisma.aiUsageEvent.findUnique({ where: { idempotencyKey: call.idempotencyKey }, select: { id: true } })
    if (dup) throw new AiCallError('DUPLICATE', 'That request was already made.')
  }

  // 1. Platform switch (also the emergency kill switch: unset it and every call stops).
  if (!externalAiEnabled()) await refuse('BLOCKED_DISABLED', 'DISABLED', 'AI writing is switched off on the platform right now.')

  // 2. Plan: feature + monthly allowance. Server-side only; no client figure is ever trusted.
  if (call.businessId) {
    const ent = call.entitlements ?? (await getBusinessEntitlements(call.businessId, now))
    if (!hasFeature(ent, call.feature)) await refuse('BLOCKED_ENTITLEMENT', 'ENTITLEMENT', 'This AI feature is not included in your plan.')
    if (call.metered ?? true) {
      const a = await allowanceFor(call.businessId, ent, now)
      if (a.generationsLimit !== null && a.generationsUsed >= a.generationsLimit) {
        await refuse('BLOCKED_ALLOWANCE', 'ALLOWANCE', a.generationsLimit === 0 ? 'AI generations are not included in your plan.' : `You have used all ${a.generationsLimit} AI generations for this month.`)
      }
      if (a.tokenBudget !== null && a.tokensUsed >= a.tokenBudget) {
        await refuse('BLOCKED_ALLOWANCE', 'ALLOWANCE', 'Your AI allowance for this month is used up.')
      }
    }
  }

  // 3. Per-person brake.
  if (call.actor.type === 'STAFF') {
    const rl = await checkRateLimits([['aiCallStaff', `${call.businessId ?? 'none'}:${call.actor.id}`]], now)
    if (!rl.allowed) await refuse('BLOCKED_RATE_LIMIT', 'RATE_LIMIT', `Too many AI requests — try again in ${Math.ceil(rl.retryAfterSeconds / 60)} min.`)
  }

  // 4. The call.
  const started = Date.now()
  const timeoutMs = call.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const body: Record<string, unknown> = { model, max_tokens: call.maxTokens, system: call.system, messages: call.messages }
  if (call.tools?.length) body.tools = call.tools
  let res: ProviderResponse
  try {
    res = await transport(body, timeoutMs)
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    const outcome: AiUsageOutcome = timedOut ? 'TIMEOUT' : 'FAILED'
    await record(call, { outcome, model, durationMs: Date.now() - started, errorClass: e instanceof Error ? e.name : 'Error' })
    log('error', 'ai.call_failed', { capability: call.capability, businessId: call.businessId, outcome, ...errorFields(e) })
    throw e instanceof AiCallError ? e : new AiCallError(timedOut ? 'TIMEOUT' : 'PROVIDER', timedOut ? 'The AI took too long to answer.' : 'The AI service is not available right now.')
  }

  // 5. Account for it.
  const inputTokens = res.usage?.input_tokens ?? 0
  const outputTokens = res.usage?.output_tokens ?? 0
  // Text blocks carry type 'text'; a block with only `text` (older shape) is treated the same.
  const text = (res.content ?? [])
    .filter((c): c is { type: 'text'; text: string } => typeof (c as { text?: unknown }).text === 'string' && (c.type === 'text' || c.type === undefined))
    .map((c) => c.text)
    .join('')
    .trim()
  const toolUses = (res.content ?? []).filter((c): c is { type: 'tool_use'; id: string; name: string; input: unknown } => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, input: c.input }))
  const usageEventId = await record(call, { outcome: 'OK', model: res.model ?? model, inputTokens, outputTokens, durationMs: Date.now() - started })
  return { text, toolUses, usage: { inputTokens, outputTokens }, model: res.model ?? model, stopReason: res.stop_reason ?? null, usageEventId }
}

/** Mark an OK call whose answer was unusable (failed validation) so it shows up as waste, not success. */
export async function markRejectedOutput(usageEventId: string | null): Promise<void> {
  if (!usageEventId) return
  await prisma.aiUsageEvent.update({ where: { id: usageEventId }, data: { outcome: 'REJECTED_OUTPUT' } }).catch(() => undefined)
}
