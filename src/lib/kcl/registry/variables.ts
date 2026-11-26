import { computed, effect, signal } from '@preact/signals-core'
import * as Effect from 'effect/Effect'
import * as ExecutionStrategy from 'effect/ExecutionStrategy'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import type { ExecutorsService } from '@src/lib/executors/registry/contract'
import type { KclExecutionCapability } from '@src/lib/kcl/execution/executor'
import type { SceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import { evaluateVariables } from '@src/lib/kcl/variables/evaluate'
import {
  VariablesEditorView,
  type VariablesState,
} from '@src/lib/kcl/variables/VariablesEditorView'
import type { ResolvedTheme } from '@src/lib/theme'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { createElement } from 'react'

export function defineVariablesView({
  capability,
  getExecutors,
  getWasm,
  nativeSettings,
  readTheme,
}: {
  capability: KclExecutionCapability
  getExecutors: () => ExecutorsService
  getWasm: () => Promise<ModuleType> | undefined
  nativeSettings: SceneExecutionSettings
  readTheme: () => ResolvedTheme
}) {
  const bindExecution = executionContext(capability, getExecutors)
  return defineEditorView((host) => {
    const execution = bindExecution(host)
    if (isErr(execution)) return execution
    const state = signal<VariablesState>({ type: 'loading' })
    const sources = computed(() => execution.result.value.data?.sources)
    const pending = computed(() => execution.result.value.running)
    const failure = computed(() => execution.result.value.error)
    const lifetime = Effect.runSync(
      Scope.fork(execution.executor.scope, ExecutionStrategy.sequential)
    )
    host.onDispose(() => Effect.runSync(Scope.close(lifetime, Exit.void)))
    const stop = effect(() => {
      const snapshot = sources.value
      const error = failure.value
      if (error || (!snapshot && !pending.value)) {
        state.value = {
          type: 'error',
          message: error?.message ?? 'No KCL source is available',
        }
        return
      }
      state.value = { type: 'loading' }
      if (!snapshot) return
      const wasm = getWasm()
      if (!wasm) {
        state.value = { type: 'error', message: 'KCL runtime is unavailable' }
        return
      }
      void nativeSettings.executeRevision.value
      const controller = new AbortController()
      const showError = (cause: unknown) => {
        if (!controller.signal.aborted)
          state.value = {
            type: 'error',
            message: isErr(cause)
              ? cause.message
              : 'Could not evaluate KCL variables',
          }
      }
      const evaluate = async () =>
        evaluateVariables(
          snapshot,
          wasm,
          nativeSettings.configuration.peek(),
          controller.signal
        )
      void evaluate().then((result) => {
        if (isErr(result)) return showError(result)
        if (!controller.signal.aborted)
          state.value = { type: 'ready', ...result }
      }, showError)
      return () => controller.abort()
    })
    Effect.runSync(Scope.addFinalizer(lifetime, Effect.sync(stop)))
    return state
  })({
    id: 'kcl.variables',
    label: 'Variables',
    matches: ({ languageId }) => languageId === 'kcl',
    priority: -110,
    Component: ({ context }) =>
      createElement(VariablesEditorView, { state: context, readTheme }),
  })
}
