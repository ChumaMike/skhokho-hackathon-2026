/**
 * Provider price estimates, USD per million tokens. ESTIMATES: used only for
 * the Control Centre's spend figure and never for anything billed to a
 * merchant. Update when the provider changes prices; an unknown model
 * yields `null` rather than a made-up number.
 */

const USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-5-5': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 1, output: 5 },
  'claude-opus-5-5': { input: 15, output: 75 },
}

/** Estimated cost in micro-dollars (1e-6 USD), or null when the model is not priced here. */
export function estimateCostUsdMicros(model: string, inputTokens: number, outputTokens: number): number | null {
  const key = Object.keys(USD_PER_MTOK).find((k) => model === k || model.startsWith(`${k}-`))
  if (!key) return null
  const p = USD_PER_MTOK[key]
  return Math.round(inputTokens * p.input + outputTokens * p.output)
}

export function formatUsdMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`
}
