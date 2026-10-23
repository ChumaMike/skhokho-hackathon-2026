/**
 * HTTP integration harness: runs the REAL production build (`next start`) as
 * a child process and talks to it over real HTTP — real middleware, real
 * route handlers, real cookies, real guards (next/headers request context).
 *
 * Safety: the child inherits this process's environment, which
 * src/lib/testing/test-env.ts has already re-pointed at TEST_DATABASE_URL.
 * The harness refuses to start unless every app database variable equals the
 * test database, and Next never overrides an env var that is already set, so
 * .env.local's app database can't be reached.
 *
 * Requires a build (`npm run build`). Used by `npm run test:http`.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'

export interface HttpResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

export interface AppServer {
  port: number
  request(method: string, path: string, opts?: { headers?: Record<string, string>; body?: string | Buffer }): Promise<HttpResponse>
  stop(): Promise<void>
}

const DB_VARS = ['POSTGRES_PRISMA_URL', 'DATABASE_URL', 'POSTGRES_URL_NON_POOLING', 'DIRECT_URL'] as const

function assertTestDatabaseOnly(env: NodeJS.ProcessEnv) {
  const test = env.TEST_DATABASE_URL
  if (!test) throw new Error('[http-server] TEST_DATABASE_URL is not set — refusing to start an app server.')
  const testHost = new URL(test).hostname.replace('-pooler', '')
  for (const k of DB_VARS) {
    const v = env[k]
    if (!v) continue
    if (new URL(v).hostname.replace('-pooler', '') !== testHost) throw new Error(`[http-server] ${k} does not point at the test database — refusing to start.`)
  }
}

export async function startAppServer(extraEnv: Record<string, string | undefined>): Promise<AppServer> {
  const root = process.cwd()
  if (!existsSync(join(root, '.next', 'BUILD_ID'))) throw new Error('[http-server] No production build found — run `npm run build` first.')
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }
  for (const [k, v] of Object.entries(extraEnv)) if (v === undefined) delete env[k]
  assertTestDatabaseOnly(env)

  const port = 31000 + Math.floor(Math.random() * 900)
  const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
  const child: ChildProcess = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout?.on('data', (d) => (log += d))
  child.stderr?.on('data', (d) => (log += d))

  const request: AppServer['request'] = (method, path, opts = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...opts.headers } }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      })
      req.on('error', reject)
      req.setTimeout(90_000, () => req.destroy(new Error(`timeout ${method} ${path}`)))
      if (opts.body) req.write(opts.body)
      req.end()
    })

  const deadline = Date.now() + 120_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`[http-server] next start exited early:\n${log.slice(-2000)}`)
    try {
      const r = await request('GET', '/api/health')
      if (r.status === 200) break
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill()
      throw new Error(`[http-server] server did not become healthy:\n${log.slice(-2000)}`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  return {
    port,
    request,
    async stop() {
      if (child.exitCode !== null) return
      if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 300))
    },
  }
}

/** Cookie header from name → token pairs. */
export function cookies(pairs: Record<string, string | undefined>): Record<string, string> {
  return { cookie: Object.entries(pairs).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ') }
}
