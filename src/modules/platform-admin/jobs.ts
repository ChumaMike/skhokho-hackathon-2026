/**
 * Background job monitoring: every scheduled task run is a job_runs row
 * (start, finish, duration, outcome, a small sanitised summary). A failure is
 * also a SYSTEM audit event and an error log line, so "the cron silently
 * stopped" and "a task keeps failing" are both visible on the health page.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { redact } from '@/lib/redact'
import { log, errorFields } from '@/lib/log'
import { systemEvent } from './audit'

export async function runJob<T>(job: string, fn: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const started = Date.now()
  const run = await prisma.jobRun.create({ data: { job }, select: { id: true } }).catch(() => null)
  try {
    const result = await fn()
    const durationMs = Date.now() - started
    if (run) {
      await prisma.jobRun
        .update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, durationMs, summary: redact(result ?? null) as Prisma.InputJsonValue } })
        .catch(() => undefined)
    }
    log('info', 'job.succeeded', { job, durationMs })
    return { ok: true, result }
  } catch (e) {
    const durationMs = Date.now() - started
    const { error } = errorFields(e)
    if (run) await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, durationMs, error } }).catch(() => undefined)
    log('error', 'job.failed', { job, durationMs, ...errorFields(e) })
    await systemEvent('job_failed', { outcome: 'FAILURE', resource: { type: 'job', id: job }, metadata: { durationMs } })
    return { ok: false, error }
  }
}

/** The latest run of each job, plus failures in the last day — for the health page. */
export async function jobHealth(now = new Date()) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const [latest, failures] = await Promise.all([
    prisma.$queryRaw<{ job: string; started_at: Date; ok: boolean | null; duration_ms: number | null; error: string | null }[]>`
      SELECT DISTINCT ON ("job") "job", "started_at", "ok", "duration_ms", "error"
      FROM "job_runs" ORDER BY "job", "started_at" DESC`,
    prisma.jobRun.count({ where: { ok: false, startedAt: { gte: since } } }),
  ])
  return { latest, failuresLast24h: failures }
}
