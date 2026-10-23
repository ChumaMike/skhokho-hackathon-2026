import { NextRequest } from 'next/server'
import { requireStaffActorWithFeature } from '@/lib/auth/entitlement-guards'
import { askAssistant } from '@/modules/assistant/assistant.service'
import { checkRateLimits, rateLimitedResponse } from '@/lib/rate-limit'
import { ok, fail, handleApiError } from '@/lib/utils'

export const runtime = 'nodejs'

/** Any signed-in team member can ask — read-only, answered only from what
 * THEIR role may see. No tenantId param: the guard takes it
 * from the caller's own token, so there's no way to ask about a business
 * that isn't yours. */
export async function POST(req: NextRequest) {
  try {
    const { actor } = await requireStaffActorWithFeature('ai_business_buddy')

    const body = await req.json().catch(() => null)
    const question = typeof body?.question === 'string' ? body.question.trim() : ''
    if (!question) return fail('Ask a question first.')
    if (question.length > 500) return fail('Keep the question under 500 characters.')
    const allowance = await checkRateLimits([['buddyChatStaff', `${actor.tenantId}:${actor.staffId}`]])
    if (!allowance.allowed) return rateLimitedResponse(allowance, { ok: false, error: "You've asked a lot of questions today — please try again tomorrow." })

    const { text, source } = await askAssistant(actor, question)
    return ok({ answer: text, source })
  } catch (error) {
    return handleApiError(error)
  }
}
