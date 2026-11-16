import type { ReadonlySignal } from '@preact/signals-core'
import { editorViewForTarget } from '@src/lib/editors/focus'
import type { EditorViewInstance } from '@src/lib/editors/registry/contract'

/** All modes edit one document history; text controls retain their own native editing history. */
export function createEditorHistory(
  views: ReadonlySignal<readonly EditorViewInstance[]>
) {
  const isLocalText = (
    instance: EditorViewInstance,
    target: EventTarget | null
  ) => {
    if (!(target instanceof Element)) return false
    if (instance.codeView.peek()?.dom.contains(target)) return false
    return (
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        ![
          'button',
          'checkbox',
          'radio',
          'range',
          'color',
          'submit',
          'reset',
          'file',
        ].includes(target.type)) ||
      target.closest('[contenteditable="true"]') !== null
    )
  }
  const direction = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y' && !event.shiftKey) return 'redo'
  }
  const targetForKey = (event: KeyboardEvent) => {
    const target = event.composedPath()[0] ?? event.target
    const instance = editorViewForTarget(views.peek(), target)
    return instance && !isLocalText(instance, target) ? instance : undefined
  }
  const apply = (
    instance: EditorViewInstance,
    action: 'undo' | 'redo',
    target: EventTarget | null
  ) => {
    const changed = instance.editor[action]()
    const code = instance.codeView.peek()
    if (changed && target instanceof Node && code?.dom.contains(target))
      code.dispatch({
        selection: instance.editor.state.selection,
        scrollIntoView: true,
      })
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const action = direction(event)
    const instance = action && targetForKey(event)
    if (!action || !instance) return
    event.preventDefault()
    event.stopPropagation()
    apply(instance, action, event.target)
  }
  window.addEventListener('keydown', onKeyDown)
  const removeMenu = window.electron?.menuOn((data) => {
    if (data.menuLabel !== 'Edit.Undo' && data.menuLabel !== 'Edit.Redo') return
    const target = document.activeElement
    const instance = editorViewForTarget(views.peek(), target)
    if (!instance) return
    const action = data.menuLabel === 'Edit.Undo' ? 'undo' : 'redo'
    if (isLocalText(instance, target)) document.execCommand(action)
    else apply(instance, action, target)
  })
  return {
    ownsKeyEvent: (event: KeyboardEvent) =>
      direction(event) !== undefined && targetForKey(event) !== undefined,
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown)
      removeMenu?.()
    },
  }
}
