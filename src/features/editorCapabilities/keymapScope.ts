import { EditorView } from '@codemirror/view'
import type { EditorCapability } from '@src/contracts/buffers'
import type { KeybindingService } from '@src/contracts/keybindings'

/** Active while a buffer has focus. */
export const CODE_EDITOR_SCOPE = 'codeEditor.focused'

/**
 * Tell the keymap when the editor has the keyboard.
 *
 * Two things depend on knowing: a bare key is a character while someone is
 * typing and must not be taken as a binding, and a binding that wants to *win*
 * inside the editor needs a scope stronger than `base` to say so in.
 *
 * A capability rather than DOM listeners in the view, because focus is a fact
 * about a mounted CodeMirror and this is the only thing that is always there
 * when one exists — every buffer, wherever it is mounted, including two at once.
 * The scope is applied and removed by the thing that knows, which is the whole
 * shape of scopes.
 */
export function createKeymapScopeCapability(dependencies: {
  keys: () => KeybindingService
}): EditorCapability {
  const { keys } = dependencies

  return {
    id: 'editor.keymapScope',
    order: 5,
    extension: () =>
      EditorView.domEventHandlers({
        focus: () => {
          keys().applyScope(CODE_EDITOR_SCOPE)
        },
        blur: () => {
          keys().removeScope(CODE_EDITOR_SCOPE)
        },
      }),
  }
}
