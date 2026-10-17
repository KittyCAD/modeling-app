import { effect, signal, type ReadonlySignal } from '@preact/signals-core'

/** Display-only snapshots. Applying changes and undo remain with the caller. */
export type CodeChangesPreview = {
  owner: object
  title: string
} & (
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; beforeText: string; afterText: string }
)

type PreviewEditor = { readonly path: string }
export type CodeChangesPreviewPublisher = (preview: CodeChangesPreview) => void

export interface CodeChangesPreviewController {
  readonly current: ReadonlySignal<CodeChangesPreview | null>
  open(
    editor: PreviewEditor,
    preview: CodeChangesPreview
  ): CodeChangesPreviewPublisher | undefined
  clear(owner?: object): void
  dispose(): void
}

/** A project owns this controller; a preview belongs to its active editor. */
export function createCodeChangesPreview(
  getEditor: () => PreviewEditor | null | undefined
): CodeChangesPreviewController {
  const current = signal<CodeChangesPreview | null>(null)
  let generation = 0
  let disposed = false
  const stop = effect(() => {
    // Track both editor identity and path: the legacy editor can be reused.
    void getEditor()?.path
    generation++
    current.value = null
  })

  return {
    current,
    open(editor, preview) {
      if (disposed || getEditor() !== editor) return
      const sourceGeneration = ++generation
      current.value = preview
      return (next) => {
        if (
          !disposed &&
          generation === sourceGeneration &&
          current.peek()?.owner === preview.owner
        ) {
          current.value = next
        }
      }
    },
    clear(owner) {
      if (owner && current.peek()?.owner !== owner) return
      generation++
      current.value = null
    },
    dispose() {
      disposed = true
      stop()
      generation++
      current.value = null
    },
  }
}
