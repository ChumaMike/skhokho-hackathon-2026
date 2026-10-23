export const MAX_QUESTION_LENGTH = 500

export type BuddyQuestionResult = { ok: true; question: string } | { ok: false; error: string }

/**
 * Checks an owner's message before it is stored or answered. Pure, so the
 * route and the tests share one set of rules.
 */
export function validateBuddyQuestion(raw: unknown): BuddyQuestionResult {
  const question = typeof raw === "string" ? raw.trim() : ""
  if (!question) return { ok: false, error: "Ask a question first." }
  if (question.length > MAX_QUESTION_LENGTH) {
    return { ok: false, error: `Keep the question under ${MAX_QUESTION_LENGTH} characters.` }
  }
  return { ok: true, question }
}
