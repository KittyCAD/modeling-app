import type { ReadonlySignal } from '@preact/signals-core'
import type {
  Executor,
  ExecutorRunContext,
} from '@src/lib/executors/registry/contract'
import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import type { KclSourceSnapshot } from '@src/lib/kcl/sources'
import { isErr } from '@src/lib/trap'
import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'

/**
 * Binds the generic executor capability to KCL source capture and a scene session.
 * `getSession` reuses a session for the same `Executor`; its Effect finalizer calls
 * `session.dispose` when that executor closes, independently of React mounts.
 */
export function createKclExecution<
  Session extends Pick<KclSession, 'execute' | 'dispose'>,
>(
  createSession: (executor: Executor) => Session,
  loadSources: (
    contents: string,
    context: ExecutorRunContext
  ) => Promise<KclSourceSnapshot | Error>,
  revision?: ReadonlySignal<unknown> | ((session: Session) => unknown)
) {
  const sessions = new WeakMap<Executor, Session>()
  const getSession = (executor: Executor) => {
    const existing = sessions.get(executor)
    if (existing) return existing
    const session = createSession(executor)
    sessions.set(executor, session)
    Effect.runSync(
      Scope.addFinalizer(executor.scope, Effect.sync(session.dispose))
    )
    return session
  }
  const capability = defineExecutorCapability({
    id: 'kcl.execution',
    revision:
      typeof revision === 'function'
        ? (executor: Executor) => revision(getSession(executor))
        : revision,
    matches: ({ languageId }) => languageId === 'kcl',
    async execute(contents: string, context: ExecutorRunContext) {
      const sources = await loadSources(contents, context)
      if (isErr(sources)) return sources
      if (context.signal.aborted)
        return new Error('KCL execution was cancelled')
      return getSession(context.executor).execute(sources, context.signal)
    },
  })
  return { capability, getSession }
}
