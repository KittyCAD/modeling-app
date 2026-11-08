import { effect, untracked, type ReadonlySignal } from '@preact/signals-core'
import type {
  Editor,
  EditorCapability,
} from '@src/lib/editors/registry/contract'
import { matchesEditor, editorMatchContext } from '@src/lib/editors/matching'
import { createEditorCleanup } from '@src/lib/editors/lifecycle'
import type { createEditorContextBoundary } from '@src/lib/editors/contextBoundary'

/** Document capabilities have no dependency on a Code surface or React mount. */
export function watchEditorCapabilities(
  editor: Editor,
  contributions: ReadonlySignal<readonly EditorCapability[]>,
  boundary: ReturnType<typeof createEditorContextBoundary>
) {
  const instances = new Map<
    EditorCapability,
    ReturnType<typeof createEditorCleanup>
  >()
  let stop: () => void
  try {
    stop = effect(() => {
      const context = editorMatchContext(editor)
      const matching = contributions.value.filter((capability) =>
        matchesEditor(capability.matches, context)
      )
      untracked(() => {
        for (const [capability, resources] of instances) {
          if (!matching.includes(capability)) {
            instances.delete(capability)
            resources.dispose()
          }
        }
        for (const capability of matching) {
          if (instances.has(capability)) continue
          const resources = createEditorCleanup()
          instances.set(capability, resources)
          try {
            boundary.run(() =>
              capability.setup({
                editor,
                onDispose: (callback) =>
                  resources.onDispose(() => boundary.run(callback)),
              })
            )
          } catch (cause) {
            resources.dispose()
            // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Editor construction must roll back a failed capability.
            throw cause
          }
        }
      })
    })
  } catch (cause) {
    for (const resources of instances.values()) resources.dispose()
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Propagate setup failure after releasing previously acquired capabilities.
    throw cause
  }
  return () => {
    stop()
    for (const resources of instances.values()) resources.dispose()
    instances.clear()
  }
}
