import { effect, untracked, type ReadonlySignal } from '@preact/signals-core'
import type {
  Editor,
  EditorCapability,
} from '@src/lib/editors/registry/contract'
import { matchesEditor, editorMatchContext } from '@src/lib/editors/matching'
import { createEditorCleanup } from '@src/lib/editors/lifecycle'
import type { createEditorContextBoundary } from '@src/lib/editors/contextBoundary'
import { isErr, trap } from '@src/lib/trap'

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
  const failed = new Set<EditorCapability>()
  const stop = effect(() => {
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
      // Retry failed setup only after the capability stops matching or is replaced,
      // rather than reporting the same failure on every keystroke.
      for (const capability of failed) {
        if (!matching.includes(capability)) failed.delete(capability)
      }
      for (const capability of matching) {
        if (instances.has(capability) || failed.has(capability)) continue
        const resources = createEditorCleanup()
        let failure: Error | undefined
        try {
          failure = boundary.run(() =>
            capability.setup({
              editor,
              onDispose: (callback) =>
                resources.onDispose(() => boundary.run(callback)),
            })
          )
        } catch (cause) {
          failure = isErr(cause) ? cause : new Error(String(cause))
        }
        if (isErr(failure)) {
          resources.dispose()
          failed.add(capability)
          trap(failure)
        } else {
          instances.set(capability, resources)
        }
      }
    })
  })
  return () => {
    stop()
    for (const resources of instances.values()) resources.dispose()
    instances.clear()
    failed.clear()
  }
}
