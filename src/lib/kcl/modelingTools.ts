import { signal, type ReadonlySignal } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import { captureModel } from '@src/lib/kcl/modelingTarget'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { ModelingToolDialog } from '@src/lib/kcl/modelingDialog'
import { isErr } from '@src/lib/trap'

/** Extensions contribute presentation and a typed dialog factory; the view owns its lifecycle. */
export interface ModelingToolDefinition {
  id: string
  name: string
  icon: Command['icon']
  createDialog: (
    context: ModelingViewContext,
    experimental: boolean,
    onClose: () => void,
    isCurrent: () => boolean
  ) => Promise<ModelingToolDialog | Error>
}

/** One mode owns its open dialog across React remounts; delayed opens cannot retarget another execution. */
export function createModelingTools(
  getContext: () => ModelingViewContext,
  definitions: ReadonlySignal<readonly ModelingToolDefinition[]>,
  showExperimentalCommands: () => boolean = () => false
) {
  const active = signal<ModelingToolDialog | undefined>(undefined)
  const error = signal<Error | undefined>(undefined)
  const opening = signal(false)
  let revision = 0
  let disposed = false
  const close = () => {
    revision++
    active.peek()?.cancel()
    active.value = undefined
    opening.value = false
  }
  return {
    definitions,
    active,
    error,
    opening,
    close,
    open: async (id: string) => {
      if (disposed) return
      close()
      error.value = undefined
      const tool = definitions.peek().find((tool) => tool.id === id)
      if (!tool) {
        error.value = new Error(`Modeling tool is not registered: ${id}`)
        return
      }
      const context = getContext()
      const captured = captureModel(context)
      if (isErr(captured)) {
        error.value = captured
        return
      }
      const ticket = ++revision
      const current = () => !disposed && revision === ticket
      opening.value = true
      try {
        const onClose = () => {
          if (current()) {
            active.value = undefined
            revision++
          }
        }
        const experimental = showExperimentalCommands()
        const result = await tool.createDialog(
          context,
          experimental,
          onClose,
          () => current() && captured.isCurrent()
        )
        if (!current()) {
          if (!isErr(result)) result.cancel()
          return
        }
        if (!captured.isCurrent()) {
          if (!isErr(result)) result.cancel()
          error.value = new Error('The model changed before the tool opened.')
          return
        }
        if (isErr(result)) error.value = result
        else active.value = result
      } catch (cause) {
        if (current())
          error.value = isErr(cause)
            ? cause
            : new Error('Unable to open the tool.', { cause })
      } finally {
        if (current()) opening.value = false
      }
    },
    dispose: () => {
      disposed = true
      close()
    },
  }
}
