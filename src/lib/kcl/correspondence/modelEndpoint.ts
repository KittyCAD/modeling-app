import { computed, type ReadonlySignal } from '@preact/signals-core'
import type { ModelingViewRuntime as ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type {
  ModelingCorrespondenceEndpoint,
  CorrespondenceExecution,
} from '@src/lib/kcl/correspondence/contract'

/** The view adapter retains native lifecycle ownership and lends the bridge only data and validated operations. */
export function modelingCorrespondenceEndpoint(
  id: symbol,
  context: ModelingViewContext,
  enabled?: ReadonlySignal<boolean>
): ModelingCorrespondenceEndpoint {
  const execution = computed<CorrespondenceExecution | undefined>(() => {
    const { executor, session } = context
    const scene = session.resource.value
    const output = executor.output.value
    const model = scene?.selection.model.value
    if (
      enabled?.value === false ||
      !scene ||
      !model ||
      output.running ||
      output.errors['kcl.execution'] ||
      scene.runtime.executing.value ||
      scene.runtime.failed.value ||
      executor.editor.contents.value !== output.contents ||
      (executor.editor.src.value ?? '') !== output.src
    )
      return undefined
    return {
      model,
      state: scene.runtime.state.value,
      output: { contents: output.contents, src: output.src },
      sources: scene.runtime.sources?.value,
    }
  })
  return {
    id,
    editorId: context.executor.editor.id,
    enabled,
    execution,
    selection: context.selection,
    interacting: computed(() => !!context.interactions.active.value),
    pickingArgument: computed(() => {
      const selection = context.session.resource.value?.selection
      return selection?.pickingEnabled.value
        ? selection.pickingArgument.value
        : undefined
    }),
    project: (run, references) => {
      const selection = context.session.resource.peek()?.selection
      if (run && selection?.model.peek() === run.model)
        selection.setCorrespondence(
          references.map((reference) => ({ reference, model: run.model }))
        )
      else selection?.setCorrespondence([])
    },
    offer: (run, references) => {
      const selection = context.session.resource.peek()?.selection
      if (!selection || execution.peek()?.model !== run.model)
        return new Error('The picking execution changed.')
      return selection.offer(
        references.map((reference) => ({ reference, model: run.model }))
      )
    },
  }
}
