import {
  defineExecutorCapability,
  type Executor,
  type ExecutorRunContext,
} from '@src/lib/executors/registry/contract'
import {
  createKclSession,
  type CreateKclStreamView,
  type KclSession,
  type KclSources,
} from '@src/lib/kcl/session'
import type { CreateViewerKclRuntime } from '@src/lib/kcl/runtime'
import { isErr } from '@src/lib/trap'
import type { ReadonlySignal } from '@preact/signals-core'
import type { KclSceneSettings } from '@src/lib/kcl/settings'
import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'

export const kclExecutorCapabilityId = 'kcl.execute'

/** Sessions outlive individual runs and React mounts, but never their owning executor. */
export function createKclExecution(
  createView: CreateKclStreamView,
  createRuntime: CreateViewerKclRuntime,
  settings?: ReadonlySignal<KclSceneSettings>,
  loadSources: (
    contents: string,
    context: ExecutorRunContext
  ) => Promise<KclSources | Error> = async (contents) => contents
) {
  const sessions = new WeakMap<Executor, KclSession>()
  const getSession = (executor: Executor) => {
    const existing = sessions.get(executor)
    if (existing) return existing
    const session = createKclSession(createView, createRuntime, settings)
    sessions.set(executor, session)
    Effect.runSync(
      Scope.addFinalizer(
        executor.scope,
        Effect.sync(() => session.dispose())
      )
    )
    return session
  }
  const capability = defineExecutorCapability({
    id: kclExecutorCapabilityId,
    matches: '.kcl',
    execute: async (contents: string, context: ExecutorRunContext) => {
      const sources = await loadSources(contents, context)
      if (isErr(sources)) return sources
      if (context.signal.aborted)
        return new Error('KCL execution was cancelled')
      return getSession(context.executor).execute(
        sources,
        context.src,
        context.signal
      )
    },
  })
  return { capability, getSession }
}
export type KclExecutorCapability = ReturnType<
  typeof createKclExecution
>['capability']
