import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'
import * as Exit from 'effect/Exit'
import * as ExecutionStrategy from 'effect/ExecutionStrategy'
import { computed, signal } from '@preact/signals-core'
import type { ExecState } from '@src/lang/wasm'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclExecutionCapability } from '@src/lib/kcl/execution/executor'
import type { KclSession } from '@src/lib/kcl/modeling/session'
import type { KclSourceSnapshot } from '@src/lib/kcl/execution/sources'
import { isErr } from '@src/lib/trap'

/** Native results and failures belong to one scene; their entity IDs cannot be used by a sibling connection. */
export interface KclViewExecutionState {
  readonly revision?: unknown
  readonly running: boolean
  readonly stale: boolean
  readonly result?: ExecState
  readonly error?: Error
}

/**
 * Run the shared executor's source snapshots in one view's native session.
 * `createKclRuntime` binds its WASM Context to that session's engine connection;
 * executing builds geometry in that connection's scene. Sharing the snapshot
 * therefore does not share native execution. Local rendering currently uses
 * the same path through a geometry-only engine connection.
 *
 * Sharing native execution later requires a reusable geometry/artifact result
 * independent of a connection, plus a way for each view's scene to present it.
 * Cameras, selection, and reconnects must remain view-owned. This bridge could
 * then consume shared results instead of calling `session.execute`; removing it
 * alone would leave sibling connections without their geometry. See the KCL
 * README's "Sharing native execution" section for the required boundaries.
 *
 * Its child scope closes with the view or the executor; closing the child does
 * not cancel sibling views. Scope.fork also removes a closed child's finalizer
 * from the parent, releasing its references.
 */
export function createKclViewExecution(
  executor: Executor,
  capability: KclExecutionCapability,
  session: Pick<KclSession, 'execute' | 'dispose'>,
  readRevision: () => unknown = () => undefined,
  readConfiguration: () => object | undefined = () => undefined
) {
  const state = signal<Omit<KclViewExecutionState, 'stale' | 'revision'>>({
    running: false,
  })
  let disposed = false
  let run = 0
  let controller: AbortController | undefined
  let retained:
    | { sources: KclSourceSnapshot; revision: unknown; configuration?: object }
    | undefined
  let published: typeof retained
  let completedRevision: unknown
  const execute = (input: NonNullable<typeof retained>) => {
    if (disposed) return
    retained = input
    const owner = ++run
    controller?.abort()
    const lifetime = new AbortController()
    controller = lifetime
    state.value = { ...state.peek(), running: true, error: undefined }
    void session
      .execute(input.sources, lifetime.signal, input.configuration)
      .then(
        (result) => {
          if (disposed || owner !== run || lifetime.signal.aborted) return
          completedRevision = input.revision
          if (!isErr(result)) published = input
          state.value = isErr(result)
            ? { ...state.peek(), running: false, error: result }
            : { running: false, result: result.result }
        },
        (cause) => {
          if (disposed || owner !== run || lifetime.signal.aborted) return
          completedRevision = input.revision
          state.value = {
            ...state.peek(),
            running: false,
            error: isErr(cause)
              ? cause
              : new Error('KCL scene execution failed', { cause }),
          }
        }
      )
  }
  const lifetime = Effect.runSync(
    Scope.fork(executor.scope, ExecutionStrategy.sequential)
  )
  Effect.runSync(
    Scope.addFinalizer(
      lifetime,
      Effect.sync(() => {
        disposed = true
        run++
        controller?.abort()
        session.dispose()
        state.value = { running: false }
      })
    )
  )
  return {
    state: computed(() => ({
      ...state.value,
      revision: completedRevision,
      running: state.value.running || executor.result(capability).value.running,
      error: executor.result(capability).value.error ?? state.value.error,
      stale:
        executor.result(capability).value.stale ||
        published?.sources !== executor.output.value.get(capability)?.sources ||
        !Object.is(published?.revision, readRevision()),
    })),
    run: (sources: KclSourceSnapshot) =>
      execute({
        sources,
        revision: readRevision(),
        configuration: readConfiguration(),
      }),
    /** Rebuild this scene from its last requested input, even when the document has newer edits. */
    refresh: (currentSettings = false) => {
      if (retained)
        execute(
          currentSettings
            ? {
                sources: retained.sources,
                revision: readRevision(),
                configuration: readConfiguration(),
              }
            : retained
        )
    },
    dispose: () => Effect.runSync(Scope.close(lifetime, Exit.void)),
  }
}
export type KclViewExecution = ReturnType<typeof createKclViewExecution>
