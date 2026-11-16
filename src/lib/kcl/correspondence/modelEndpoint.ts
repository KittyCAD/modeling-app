import { entityReferenceKey } from '@src/lib/scene/entityReference'
import type { SelectionModel } from '@src/lib/scene/selection'
import type { EntityStyleHandle } from '@src/lib/scene/entityStyling'
import { computed, effect, type ReadonlySignal } from '@preact/signals-core'
import type { ModelingViewRuntime as ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type {
  ModelingCorrespondenceEndpoint,
  CorrespondenceExecution,
  CorrespondenceLayer,
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
  const groups = new Map<symbol, EntityStyleHandle>()
  let owner: SelectionModel | undefined
  const clear = () => {
    for (const group of groups.values()) group.dispose()
    groups.clear()
  }
  let stopDialog: (() => void) | undefined
  let currentLayers: readonly CorrespondenceLayer[] = []
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
    project: (run, layers) => {
      const scene = context.session.resource.peek()
      const selection = scene?.selection
      if (!run || !scene || selection?.model.peek() !== run.model) {
        stopDialog?.()
        stopDialog = undefined
        clear()
        owner = undefined
        currentLayers = []
        selection?.setCorrespondence([])
        return
      }
      const values = new Map(
        layers.flatMap((layer) =>
          layer.references.map(
            (reference) =>
              [
                entityReferenceKey(reference),
                { reference, model: run.model },
              ] as const
          )
        )
      )
      selection.setCorrespondence([...values.values()])
      const styling = scene.entityStyling
      if (scene.presentation !== 'local' || !styling) return
      if (owner !== run.model) {
        stopDialog?.()
        stopDialog = undefined
        clear()
        owner = run.model
      }
      currentLayers = layers
      const project = () => {
        if (selection.dialogOpen.value) {
          clear()
          return
        }
        const wanted = new Set(currentLayers.map((layer) => layer.sourceViewId))
        for (const [id, group] of groups)
          if (!wanted.has(id)) {
            group.dispose()
            groups.delete(id)
          }
        for (const layer of currentLayers) {
          let group = groups.get(layer.sourceViewId)
          if (!group) {
            const created = styling.createGroup(layer.style)
            if (created instanceof Error) continue
            group = created
            groups.set(layer.sourceViewId, group)
          }
          group.set(layer.references)
        }
      }
      if (!stopDialog) stopDialog = effect(project)
      else project()
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
