/**
 * Structured logging: one JSON object per line, so the hosting log drain can
 * filter by `event`, `level` and `env`, plus `requestId` / `businessId` when
 * the caller has them (pass them in `fields`; there is no ambient request
 * context in route handlers). Every field passes through the same redaction
 * as the audit trail — a log line can never carry a password, code, token,
 * cookie, key or bank number, whatever a caller passes in.
 */

import { redact } from './redact'

export type LogLevel = 'info' | 'warn' | 'error'

/** `production` / `preview` / `development` on Vercel; NODE_ENV elsewhere. */
const ENV = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), env: ENV, level, event, ...(redact(fields) as Record<string, unknown>) })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** An error's name and message only — never its stack, cause chain or attached request/response bodies. */
export function errorFields(e: unknown): { error: string; errorName?: string } {
  if (e instanceof Error) return { errorName: e.name, error: e.message.slice(0, 300) }
  return { error: String(e).slice(0, 300) }
}
