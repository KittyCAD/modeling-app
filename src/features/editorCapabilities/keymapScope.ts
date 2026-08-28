import { ViewPlugin } from '@codemirror/view'
import type { EditorCapability } from '@src/contracts/buffers'
import type { KeybindingService } from '@src/contracts/keybindings'

/** Active while a buffer has focus. */
export const CODE_EDITOR_SCOPE = 'codeEditor.focused'

/**
 * Tell the keymap when the editor has the keyboard.
 *
 * Three things depend on knowing: a bare key is a character while someone is
 * typing and must not be taken as a binding; a binding that wants to *win*
 * inside the editor needs a scope stronger than `base` to say so in; and the
 * cursor only speaks for where the user is while the editor is where they are.
 *
 * A capability rather than DOM listeners in the view, because focus is a fact
 * about a mounted CodeMirror and this is the only thing that is always there
 * when one exists — every buffer, wherever it is mounted, including two at once.
 * The scope is applied and removed by the thing that knows, which is the whole
 * shape of scopes.
 *
 * A view plugin rather than plain event handlers, for one reason: a focused
 * element that is *removed* fires no blur. Closing the code panel would
 * otherwise leave the scope applied forever, with the app convinced somebody is
 * still typing. The plugin's `destroy` is the blur that never comes.
 *
 * Ownership is per view, so releasing on teardown cannot take the scope away
 * from a second editor that still has focus.
 */
export function createKeymapScopeCapability(dependencies: {
  keys: () => KeybindingService
}): EditorCapability {
  const { keys } = dependencies

  return {
    id: 'editor.keymapScope',
    order: 5,
    extension: () =>
      ViewPlugin.define(
        (view) => {
          let holding = false

          const hold = () => {
            if (holding) return
            holding = true
            keys().applyScope(CODE_EDITOR_SCOPE)
          }

          const release = () => {
            if (!holding) return
            holding = false
            keys().removeScope(CODE_EDITOR_SCOPE)
          }

          // A view can be created already focused — mounting one into a panel
          // that had focus, or restoring a layout — and no focus event follows.
          if (view.hasFocus) hold()

          return { hold, release, destroy: release }
        },
        {
          eventHandlers: {
            focus() {
              this.hold()
            },
            blur() {
              this.release()
            },
          },
        }
      ),
  }
}

/** Whether a buffer currently has the keyboard, as the keymap sees it. */
export const editorHasFocus = (keys: KeybindingService): boolean =>
  keys.activeScopes.value.includes(CODE_EDITOR_SCOPE)
