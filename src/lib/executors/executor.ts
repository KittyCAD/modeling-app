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

type Attempt = {
  input: ExecutionInput
  id: symbol
  controller: AbortController
}

/** Own requested work separately from live inputs. Only a newer request, withdrawal, or shutdown interrupts a run. */
export function createExecutor(
  editor: Editor,
  contributions: ReadonlySignal<readonly ExecutorCapability[]>,
  onEditorDestroyed: () => void
): { executor: Executor; dispose: () => void } {
  let disposed = false
  const scope = Effect.runSync(Scope.make())
  const active = new Map<ExecutorCapability, Attempt>()
  const completed = new Map<
    ExecutorCapability,
    {
      input: ExecutionInput
      id: symbol
      value: Record<string, unknown> | Error
    }
  >()
  const changed = signal(0)
  const inputs = new WeakMap<
    ExecutorCapability,
    ReadonlySignal<ExecutionInput | undefined>
  >()
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
    // Each entry is created from and retained under the same capability identity.
    return observation as ReadonlySignal<ExecutionResult<CapabilityData<C>>>
  }
  const initial = {
    src: editor.src.peek() ?? '',
    contents: editor.contents.peek(),
  }
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
      const cancelled = new Promise<undefined>((resolve) => {
        abort = () => resolve(undefined)
        signal.addEventListener('abort', abort, { once: true })
      })
      const publish = (value: Record<string, unknown> | Error) => {
        if (disposed || signal.aborted || active.get(capability) !== attempt)
          return
        active.delete(capability)
        completed.set(capability, { input: captured, id: attempt.id, value })
        changed.value++
      }
      try {
        // Invoke synchronously so domain adapters can capture their additional inputs before the caller edits again.
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
  // Withdrawal ends the capability's ownership; changing applicability only marks its retained result stale.
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
      Effect.runFork(Scope.close(scope, Exit.void))
    },
  }
}

export function sameExecutionInput(a: ExecutionInput, b: ExecutionInput) {
  return (
    a.src === b.src &&
    a.contents === b.contents &&
    Object.is(a.revision, b.revision)
  )
}
