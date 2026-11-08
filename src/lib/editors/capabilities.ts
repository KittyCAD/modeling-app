import type { Compartment, Extension } from '@codemirror/state'
import { computed, type ReadonlySignal } from '@preact/signals-core'
import type {
  Editor,
  EditorCapability,
} from '@src/lib/editors/registry/contract'
import { editorMatchContext, matchesEditor } from '@src/lib/editors/matching'

/** Reconfigure one buffer without recreating its extensions, document, selection, or history. */
export function watchEditorCapabilities(
  editor: Editor,
  contributions: ReadonlySignal<readonly EditorCapability[]>,
  compartment: Compartment,
  isPublishingContents: () => boolean
) {
  const instances = new WeakMap<EditorCapability, Extension>()
  const matching = computed(() =>
    contributions.value
      .filter((capability) =>
        matchesEditor(capability.matches, editorMatchContext(editor))
      )
      .map((capability) => {
        let extension = instances.get(capability)
        if (!extension) {
          extension =
            typeof capability.capabilities === 'function'
              ? capability.capabilities(editor)
              : capability.capabilities
          instances.set(capability, extension)
        }
        return extension
      })
  )
  let current: readonly Extension[] = []
  let closed = false
  let queued = false
  const apply = (next: readonly Extension[]) => {
    if (
      closed ||
      (next.length === current.length &&
        next.every((extension, index) => extension === current[index]))
    )
      return
    editor.view.dispatch({ effects: compartment.reconfigure(next) })
    current = next
  }
  const stop = matching.subscribe((next) => {
    if (!isPublishingContents()) {
      apply(next)
      return
    }
    // CodeMirror forbids nested dispatch. Coalesce typing into the latest set of matches.
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!closed) apply(matching.peek())
    })
  })
  return () => {
    closed = true
    stop()
  }
}
