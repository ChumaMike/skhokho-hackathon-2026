import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external'

/**
 * Runs a route handler the way tests call it directly (`await POST(req)`)
 * but inside enough of Next's request scope for `after()` to work.
 *
 * Why: `after` from 'next/server' (Next 15.5) reads
 * `workAsyncStorage.getStore().afterContext` and throws
 * "`after` was called outside a request scope" when a test invokes the
 * handler without a real server. The storefront routes call `after()` for
 * notifications AFTER the database write, so without this a test sees the
 * row created but an error response — a harness artefact, not app
 * behaviour. The HTTP suite (`src/lib/testing/http-server.ts`) has the real
 * scope; this is the in-process stand-in for DB tests.
 *
 * Tasks queued with `after()` run once the handler has returned, in order,
 * like Next does post-response. An error in one is reported, not thrown:
 * Next logs after-task errors without failing the response, and a test
 * asserting on the response should see the same.
 *
 * If a Next upgrade changes the store shape, this is the one place to fix.
 */
export async function withRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  const tasks: Array<() => unknown> = []
  const store = {
    afterContext: {
      after(task: (() => unknown) | Promise<unknown>) {
        tasks.push(typeof task === 'function' ? task : () => task)
      },
    },
  }
  const result = await workAsyncStorage.run(store as never, fn)
  for (const task of tasks) {
    try {
      await task()
    } catch (e) {
      console.warn('[request-scope] after() task failed:', (e as Error).message)
    }
  }
  return result
}
