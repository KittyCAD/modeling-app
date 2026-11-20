import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'
import * as Exit from 'effect/Exit'
import * as ExecutionStrategy from 'effect/ExecutionStrategy'
import { computed, effect, signal } from '@preact/signals-core'
import type { ExecState } from '@src/lang/wasm'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclExecutionCapability } from '@src/lib/kcl/executor'
import type { KclSession } from '@src/lib/kcl/session'
import type { KclSourceSnapshot } from '@src/lib/kcl/sources'
import { isErr } from '@src/lib/trap'

/** Native results and failures belong to one scene; their entity IDs cannot be used by a sibling connection. */
export interface KclViewExecutionState {
  readonly running: boolean
  readonly result?: ExecState
  readonly error?: Error
}

/**
 * Run shared snapshots in one view's session. Its child scope closes with the
 * view or the executor; closing the child does not cancel sibling views. Scope.fork
 * also removes a closed child's finalizer from the parent, releasing its references.
 */
export function createKclViewExecution(
  executor: Executor,
  capability: KclExecutionCapability,
  session: Pick<KclSession, 'execute' | 'dispose'>,
  readRevision: () => unknown = () => undefined
) {
  const state = signal<KclViewExecutionState>({ running: true })
  const refresh = signal(0)
  let disposed = false
  let run = 0
  let controller: AbortController | undefined
  let previous:
    | { sources: KclSourceSnapshot; revision: unknown; refresh: number }
    | undefined
  const stop = effect(() => {
    const output = executor.output.value
    const sources = output.get(capability)?.sources
    const revision = readRevision()
    const requested = refresh.value
    const error = output.errors[capability.id]
    if (!sources || error) {
      run++
      controller?.abort()
      previous = undefined
      state.value = { running: output.running, error }
      return
    }
    if (
      previous?.sources === sources &&
      Object.is(previous.revision, revision) &&
      previous.refresh === requested
    )
      return
    previous = { sources, revision, refresh: requested }
    const owner = ++run
    controller?.abort()
    const lifetime = new AbortController()
    controller = lifetime
    state.value = { running: true }
    // Calling execute here captures the session's current connection attempt.
    const execute = async () => session.execute(sources, lifetime.signal)
    void execute().then(
      (result) => {
        if (disposed || owner !== run || lifetime.signal.aborted) return
        state.value = isErr(result)
          ? { running: false, error: result }
          : { running: false, result: result.result }
      },
      (cause) => {
        if (disposed || owner !== run || lifetime.signal.aborted) return
        state.value = {
          running: false,
          error: isErr(cause)
            ? cause
            : new Error('KCL scene execution failed', { cause }),
        }
      }
    )
  })
  const lifetime = Effect.runSync(
    Scope.fork(executor.scope, ExecutionStrategy.sequential)
  )
  Effect.runSync(
    Scope.addFinalizer(
      lifetime,
      Effect.sync(() => {
        disposed = true
        run++
        stop()
        controller?.abort()
        session.dispose()
        state.value = { running: false }
      })
    )
  )
  return {
    state: computed(() => state.value),
    /** Rebuild only this scene from the latest shared snapshot. */
    refresh: () => {
      if (!disposed) refresh.value++
    },
    dispose: () => Effect.runSync(Scope.close(lifetime, Exit.void)),
  }
}
export type KclViewExecution = ReturnType<typeof createKclViewExecution>
