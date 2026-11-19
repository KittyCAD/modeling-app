import { effect, untracked } from '@preact/signals-core'
import { EDITOR_SAVE_DEBOUNCE_MS } from '@src/lib/constants'
import type {
  Editor,
  EditorResourceHost,
} from '@src/lib/editors/registry/contract'
import type { EditorSave } from '@src/lib/save/registry/contract'
import { reportRejection, trap } from '@src/lib/trap'

/** Debounce the backing document, so every mode and multiple views share one timer. */
export function attachAutosave(
  { editor, onDispose }: EditorResourceHost,
  saving: EditorSave,
  enabled: (editor: Editor) => boolean
) {
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const eligible = () =>
    !closed &&
    !editor.signal.aborted &&
    Boolean(editor.src.peek()) &&
    !editor.readOnly.peek() &&
    enabled(editor)
  const schedule = () => {
    cancel()
    if (!eligible() || !saving.state(editor).peek().dirty) return
    timer = setTimeout(() => {
      timer = undefined
      if (!eligible() || !saving.state(editor).peek().dirty) return
      void saving
        .save(editor)
        .then((error) => {
          if (error && eligible()) trap(error)
        })
        .catch(reportRejection)
    }, EDITOR_SAVE_DEBOUNCE_MS)
  }
  onDispose(
    editor.subscribe((transaction) => {
      if (transaction.docChanged) schedule()
    })
  )
  onDispose(
    effect(() => {
      void editor.src.value
      void editor.readOnly.value
      enabled(editor)
      untracked(schedule)
    })
  )
  onDispose(() => {
    closed = true
    cancel()
  })
}
