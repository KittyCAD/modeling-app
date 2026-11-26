import {
  computed,
  effect,
  signal,
  untracked,
  type ReadonlySignal,
} from '@preact/signals-core'
import { editorMatchContext, matchesEditor } from '@src/lib/editors/matching'
import type { Editor } from '@src/lib/editors/registry/contract'
import { createExecutorOutput } from '@src/lib/executors/output'
import type {
  CapabilityData,
  ExecutionInput,
  ExecutionResult,
  Executor,
  ExecutorCapability,
} from '@src/lib/executors/registry/contract'
import { isErr } from '@src/lib/trap'
import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'
import * as Exit from 'effect/Exit'

/** One explicit `run` request; input equality does not make two requests the same attempt. */
type Attempt = {
  input: ExecutionInput
  id: symbol
  controller: AbortController
}

/**
 * Runs registry-contributed computations for one editor and retains their results.
 *
 * `input` observes the live document and capability dependencies; `run` captures
 * them for an attempt. An edit makes an older result stale without cancelling
 * that attempt or starting another. `acquireAutomaticExecution` supplies the
 * separate policy that requests work in response to input changes.
 *
 * Each capability has at most one active attempt and one completed result.
 * A newer request replaces only that capability's active attempt. Withdrawing
 * its registry contribution removes both; disposing ends all active attempts.
 */
export function createExecutor(
  editor: Editor,
  contributions: ReadonlySignal<readonly ExecutorCapability[]>,
  onEditorDestroyed: () => void
): { executor: Executor; dispose: () => void } {
  let disposed = false
  const scope = Effect.runSync(Scope.make())
  // Key by the contributed object, not its public `id`: a replacement with the
  // same `id` must not inherit the old contribution's work or result.
  const active = new Map<ExecutorCapability, Attempt>()
  const completed = new Map<
    ExecutorCapability,
    {
      input: ExecutionInput
      id: symbol
      value: Record<string, unknown> | Error
    }
  >()
  // The maps are ordinary mutable collections. Publishing, starting, removing,
  // or disposing work increments this signal so result observations recompute.
  const changed = signal(0)
  const inputs = new WeakMap<
    ExecutorCapability,
    ReadonlySignal<ExecutionInput | undefined>
  >()
  // Cache a lazy observation per capability. Reading inputs never calls `execute`;
  // an installed contribution can also become ineligible as the editor changes.
  const input = (capability: ExecutorCapability) => {
    let observation = inputs.get(capability)
    if (!observation) {
      observation = computed(() => {
        const context = editorMatchContext(editor)
        if (
          !contributions.value.includes(capability) ||
          !matchesEditor(capability.matches, context)
        )
          return undefined
        return {
          src: context.src,
          contents: context.contents,
          revision:
            typeof capability.revision === 'function'
              ? capability.revision(executor)
              : capability.revision?.value,
        }
      })
      inputs.set(capability, observation)
    }
    return observation
  }
  const results = new WeakMap<
    ExecutorCapability,
    ReadonlySignal<ExecutionResult>
  >()
  const result = <C extends ExecutorCapability>(
    capability: C
  ): ReadonlySignal<ExecutionResult<CapabilityData<C>>> => {
    let observation = results.get(capability)
    if (!observation) {
      observation = computed(() => {
        void changed.value
        const last = completed.get(capability)
        const current = input(capability).value
        // Keep the last completion visible during a replacement run. Freshness
        // compares that completion with live inputs, not the pending request.
        // A returned error is also a completion; `stale` does not mean success.
        return {
          requested: active.get(capability)?.input ?? last?.input,
          input: last?.input,
          completed: last?.id,
          data: last?.value && !isErr(last.value) ? last.value : undefined,
          error: isErr(last?.value) ? last.value : undefined,
          running: active.has(capability),
          stale: !last || !current || !sameExecutionInput(last.input, current),
        } satisfies ExecutionResult
      })
      results.set(capability, observation)
    }
    // `results` stores observations for capabilities with different return types.
    // The map erases that relationship; each observation above reads only the
    // completion written for this same capability object by `publish`.
    // This assertion restores the type relationship; it performs no runtime check.
    return observation as ReadonlySignal<ExecutionResult<CapabilityData<C>>>
  }
  const initial = {
    src: editor.src.peek() ?? '',
    contents: editor.contents.peek(),
  }
  // The summary names the most recently requested document text. Individual
  // capability completions can describe older inputs; `result` exposes those.
  let latest = initial
  const output = computed(() => {
    void changed.value
    return createExecutorOutput(
      { ...latest, running: active.size > 0 },
      [...completed].map(
        ([capability, attempt]) => [capability, attempt.value] as const
      )
    )
  })
  const executor: Executor = {
    id: Symbol(editor.src.peek()),
    editor,
    scope,
    output,
    input,
    result,
    run: async (capability) => {
      if (disposed || editor.signal.aborted) return
      const currentInput = input(capability).peek()
      if (!currentInput) return
      // A repeated request for unchanged text still has its own identity.
      // Consumers can capture additional inputs once for each `requested` value.
      const captured = { ...currentInput }
      active.get(capability)?.controller.abort()
      const attempt: Attempt = {
        input: captured,
        id: Symbol(),
        controller: new AbortController(),
      }
      active.set(capability, attempt)
      latest = captured
      changed.value++
      const signal = attempt.controller.signal
      let abort = () => {}
      // Let `run` settle on cancellation even if `execute` ignores its signal.
      // This does not stop the underlying promise; `publish` rejects late replies.
      const cancelled = new Promise<undefined>((resolve) => {
        abort = () => resolve(undefined)
        signal.addEventListener('abort', abort, { once: true })
      })
      // Cancellation can leave `execute` running. Only the attempt still stored
      // in `active` may replace the retained completion, including with an error.
      const publish = (value: Record<string, unknown> | Error) => {
        if (disposed || signal.aborted || active.get(capability) !== attempt)
          return
        active.delete(capability)
        completed.set(capability, { input: captured, id: attempt.id, value })
        changed.value++
      }
      try {
        // Call `execute` before the first `await`: adapters can capture imports
        // or settings while they still correspond to this request. Only text,
        // path, and the dependency revision are captured by this executor.
        const value = await Promise.race([
          Promise.resolve(
            capability.execute(captured.contents, {
              executor,
              editor,
              src: captured.src,
              signal,
            })
          ),
          cancelled,
        ])
        if (value !== undefined) publish(value)
      } catch (cause) {
        publish(isErr(cause) ? cause : new Error(String(cause)))
      } finally {
        signal.removeEventListener('abort', abort)
      }
    },
  }
  // Removing a registry contribution cancels and forgets its work. A matcher
  // becoming false instead makes `input` undefined and the retained result stale.
  // Track only contribution changes: result publication must not rerun this effect.
  const stop = effect(() => {
    const installed = contributions.value
    untracked(() => {
      let removed = false
      for (const capability of new Set([
        ...active.keys(),
        ...completed.keys(),
      ])) {
        if (installed.includes(capability)) continue
        active.get(capability)?.controller.abort()
        active.delete(capability)
        completed.delete(capability)
        inputs.delete(capability)
        removed = true
      }
      if (removed) changed.value++
    })
  })
  editor.signal.addEventListener('abort', onEditorDestroyed, { once: true })
  return {
    executor,
    dispose: () => {
      if (disposed) return
      disposed = true
      stop()
      editor.signal.removeEventListener('abort', onEditorDestroyed)
      for (const attempt of active.values()) attempt.controller.abort()
      active.clear()
      changed.value++
      // Stop accepting replies before starting asynchronous resource cleanup.
      // Policies such as `acquireAutomaticExecution` register cleanup in `scope`;
      // this synchronous disposer does not wait for their finalizers to finish.
      Effect.runFork(Scope.close(scope, Exit.void))
    },
  }
}

/**
 * Revisions are opaque dependency tokens, not values for this module to inspect.
 * A capability must change its revision identity when those dependencies change;
 * that producer contract makes `Object.is` sufficient for freshness comparisons.
 */
export function sameExecutionInput(a: ExecutionInput, b: ExecutionInput) {
  return (
    a.src === b.src &&
    a.contents === b.contents &&
    Object.is(a.revision, b.revision)
  )
}
