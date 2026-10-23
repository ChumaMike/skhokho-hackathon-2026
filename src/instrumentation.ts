/**
 * Runs once when a server instance starts (Next.js instrumentation hook).
 * Validates production configuration: on a production deployment, a missing
 * startup variable stops the instance rather than letting it run with an
 * insecure fallback. Feature variables only disable their feature.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { validateEnvironment, isProductionDeployment } = await import('./lib/env-check')
  const report = validateEnvironment()
  for (const line of report.disabled) console.warn('[config] feature disabled:', line)
  if (report.fatal.length === 0) return
  if (isProductionDeployment()) {
    for (const line of report.fatal) console.error('[config] FATAL:', line)
    throw new Error(`Production configuration incomplete (${report.fatal.length} problem(s)) — see logs.`)
  }
  for (const line of report.fatal) console.warn('[config] would be fatal in production:', line)
}
