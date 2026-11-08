import { effect, signal, type ReadonlySignal } from '@preact/signals-core'
import { editorMatchContext, matchesEditor } from '@src/lib/editors/matching'
import type { Editor } from '@src/lib/editors/registry/contract'
import {
  createExecutorOutput,
  type ExecutorResult,
} from '@src/lib/executors/output'
import type {
  Executor,
  ExecutorCapability,
  ExecutorOutput,
} from '@src/lib/executors/registry/contract'
import { isErr, reportRejection } from '@src/lib/trap'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Fiber from 'effect/Fiber'
import * as Scope from 'effect/Scope'
import * as Exit from 'effect/Exit'

/** A run captures source, contents, and applicable contributions together. */
interface ExecutionInput {
  src: string
  contents: string
  capabilities: readonly ExecutorCapability[]
}

/** Owns a scoped watcher and interrupts the previous computation before starting another. */
export function createExecutor(
  editor: Editor,
  contributions: ReadonlySignal<readonly ExecutorCapability[]>,
  onEditorDestroyed: () => void
): { executor: Executor; dispose: () => void } {
  const snapshot = (): ExecutionInput => {
    const context = editorMatchContext(editor)
    return {
      ...context,
      capabilities: contributions.value.filter((capability) =>
        matchesEditor(capability.matches, context)
      ),
    }
  }
  const pending = (input: ExecutionInput): ExecutorOutput =>
    createExecutorOutput({
      src: input.src,
      contents: input.contents,
      running: input.capabilities.length > 0,
    })
  const output = signal<ExecutorOutput>(pending(snapshot()))
  const execute = (input: ExecutionInput) =>
    Effect.gen(function* () {
      if (input.capabilities.length === 0) return
      // Yield before starting computations so edits from the same turn coalesce.
      yield* Effect.promise(() => Promise.resolve())
      const completed: ExecutorResult[] = []
      const results = yield* Effect.forEach(
        input.capabilities,
        (capability) =>
          Effect.tryPromise({
            try: (signal) =>
              Promise.resolve(
                capability.execute(input.contents, {
                  executor,
                  editor,
                  src: input.src,
                  signal,
                })
              ),
            catch: (cause) => (isErr(cause) ? cause : new Error(String(cause))),
          }).pipe(
            Effect.flatMap((result) =>
              isErr(result) ? Effect.fail(result) : Effect.succeed(result)
            ),
            Effect.either,
            Effect.map(
              (result) =>
                [
                  capability,
                  Either.isLeft(result) ? result.left : result.right,
                ] as const
            ),
            Effect.tap((result) =>
              Effect.sync(() => {
                completed.push(result)
                // A view can use its result while an unrelated capability awaits resources.
                output.value = createExecutorOutput(
                  { src: input.src, contents: input.contents, running: true },
                  completed
                )
              })
            )
          ),
        { concurrency: 'unbounded' }
      )
      output.value = createExecutorOutput(
        {
          src: input.src,
          contents: input.contents,
          running: false,
        },
        results
      )
    })
  const scope = Effect.runSync(Scope.make())
  const executor: Executor = {
    id: Symbol(editor.src.peek()),
    editor,
    output,
    scope,
  }
  let currentRun: Fiber.RuntimeFiber<void, never> | undefined
  let previous: ExecutionInput | undefined
  Effect.runSync(
    Effect.acquireRelease(
      Effect.sync(() => {
        editor.signal.addEventListener('abort', onEditorDestroyed, {
          once: true,
        })
        return effect(() => {
          const next = snapshot()
          if (previous && sameInput(previous, next)) return
          previous = next
          // Interrupt at the signal boundary, before a queued old completion can
          // publish. A buffered stream alone leaves a window before consumption.
          if (currentRun) Effect.runSync(Fiber.interruptFork(currentRun))
          output.value = pending(next)
          currentRun = Effect.runSync(
            Effect.forkIn(
              execute(next).pipe(
                Effect.catchAllCause((cause) =>
                  Cause.isInterruptedOnly(cause)
                    ? Effect.void
                    : Effect.sync(() => reportRejection(Cause.pretty(cause)))
                )
              ),
              scope
            )
          )
        })
      }),
      (unsubscribe) =>
        Effect.sync(() => {
          unsubscribe()
          editor.signal.removeEventListener('abort', onEditorDestroyed)
        })
    ).pipe(Scope.extend(scope))
  )
  return {
    executor,
    dispose: () => {
      if (currentRun) Effect.runSync(Fiber.interruptFork(currentRun))
      Effect.runFork(Scope.close(scope, Exit.void))
      output.value = { ...output.peek(), running: false }
    },
  }
}

function sameInput(previous: ExecutionInput, next: ExecutionInput) {
  return (
    previous.src === next.src &&
    previous.contents === next.contents &&
    previous.capabilities.length === next.capabilities.length &&
    previous.capabilities.every(
      (capability, index) => capability === next.capabilities[index]
    )
  )
}
