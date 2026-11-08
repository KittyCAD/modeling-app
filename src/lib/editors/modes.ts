import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import { createEditorContextBoundary } from '@src/lib/editors/contextBoundary'
import { createEditorCleanup } from '@src/lib/editors/lifecycle'
import { editorMatchContext, matchesEditor } from '@src/lib/editors/matching'
import type {
  EditorViewInstance,
  EditorViewBinding,
  EditorViewContribution,
  EditorViewState,
} from '@src/lib/editors/registry/contract'
import { isErr } from '@src/lib/trap'

/** A bound mode survives React remounts and switches; losing its match releases its resources. */
export function createEditorModes(
  presentation: EditorViewInstance,
  views: ReadonlySignal<readonly EditorViewContribution[]>,
  contextBoundary = createEditorContextBoundary()
) {
  const editor = presentation.editor
  const lifetime = createEditorCleanup()
  const choice = signal<string | undefined>(undefined)
  const options = computed(() => {
    const available = views.value
      .filter((view) => matchesEditor(view.matches, editorMatchContext(editor)))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    return {
      available,
      selected:
        available.find((view) => view.id === choice.value) ?? available[0],
    }
  })
  const instances = new Map<
    EditorViewContribution,
    { binding: EditorViewBinding; dispose: () => void }
  >()
  const bound = signal<
    { view: EditorViewContribution; binding: EditorViewBinding } | undefined
  >(undefined)
  let refreshing = false
  const refresh = () => {
    if (lifetime.closed || refreshing) return
    refreshing = true
    try {
      const available = options.peek().available
      for (const [view, instance] of instances) {
        if (available.includes(view)) continue
        // Detach before invoking contributed cleanup, even if it fails.
        instances.delete(view)
        instance.dispose()
        if (lifetime.closed) return
      }
      const { selected } = options.peek()
      if (!selected) {
        bound.value = undefined
        return
      }
      let instance = instances.get(selected)
      if (!instance) {
        const resources = createEditorCleanup()
        let binding: EditorViewBinding
        try {
          binding = {
            type: 'ready',
            Component: contextBoundary.run(() =>
              selected.bind({
                editor,
                instance: presentation,
                onDispose: (callback) =>
                  resources.onDispose(() => contextBoundary.run(callback)),
              })
            ),
          }
        } catch (cause) {
          resources.dispose()
          binding = {
            type: 'error',
            error: isErr(cause) ? cause : new Error(String(cause)),
          }
        }
        if (lifetime.closed) {
          resources.dispose()
          return
        }
        instance = { binding, dispose: resources.dispose }
        instances.set(selected, instance)
      }
      bound.value = { view: selected, binding: instance.binding }
    } finally {
      refreshing = false
    }
  }
  lifetime.onDispose(() => {
    const pending = [...instances.values()]
    instances.clear()
    for (const instance of pending) instance.dispose()
  })
  // Providers can dispatch CodeMirror effects, so never bind from its document update listener.
  let queued = false
  lifetime.onDispose(
    options.subscribe(() => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        refresh()
      })
    })
  )
  const state = computed<EditorViewState>(() => ({
    ...options.value,
    binding:
      bound.value?.view === options.value.selected
        ? (bound.value?.binding ?? { type: 'unbound' })
        : { type: 'unbound' },
  }))
  return {
    state,
    refresh,
    select: (id: string) => {
      if (options.peek().available.some((view) => view.id === id))
        choice.value = id
      refresh()
    },
    dispose: lifetime.dispose,
  }
}
