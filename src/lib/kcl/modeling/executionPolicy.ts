import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'
import * as Exit from 'effect/Exit'
import * as ExecutionStrategy from 'effect/ExecutionStrategy'
import { effect, untracked } from '@preact/signals-core'
import { acquireAutomaticExecution } from '@src/lib/executors/automatic'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclExecutionCapability } from '@src/lib/kcl/execution/executor'
import type { KclViewExecution } from '@src/lib/kcl/modeling/viewExecution'

/** Source requests are shared; each scene independently consumes explicitly completed captures and settings policy. */
export function acquireKclExecutionPolicy(
  executor: Executor,
  capability: KclExecutionCapability,
  view: KclViewExecution,
  automatic: () => boolean,
  readRevision: () => unknown
) {
  const release = acquireAutomaticExecution(executor, capability, automatic)
  // Opening a model is an explicit initial request, including when automatic rendering is disabled.
  const initial = executor.result(capability).peek()
  if (!initial.completed && !initial.running) void executor.run(capability)
  let previous: { completed: symbol; revision: unknown } | undefined
  const stop = effect(() => {
    const source = executor.result(capability).value
    const enabled = automatic()
    const revision = readRevision()
    const state = view.state.value
    if (state.running || (enabled && source.stale)) return
    if (!source.completed || !source.data || source.error) return
    if (
      previous?.completed === source.completed &&
      (!enabled || Object.is(state.revision, revision))
    )
      return
    previous = { completed: source.completed, revision }
    untracked(() => view.run(source.data!.sources))
  })
  const lifetime = Effect.runSync(
    Scope.fork(executor.scope, ExecutionStrategy.sequential)
  )
  Effect.runSync(
    Scope.addFinalizer(
      lifetime,
      Effect.sync(() => {
        stop()
        release()
      })
    )
  )
  return () => {
    Effect.runSync(Scope.close(lifetime, Exit.void))
  }
}
