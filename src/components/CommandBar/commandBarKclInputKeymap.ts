import { completionStatus } from '@codemirror/autocomplete'
import type { KeyBinding } from '@codemirror/view'

export function createCommandBarKclInputKeymap({
  onSubmit,
  stepBack,
}: {
  onSubmit: () => void
  stepBack: () => void
}): KeyBinding[] {
  return [
    {
      key: 'Enter',
      preventDefault: true,
      run: (editor) => {
        // The autocomplete keymap has higher precedence and accepts an active
        // completion first. While completions are still pending, consume Enter
        // so the single-line field can never fall through to a native newline.
        if (completionStatus(editor.state) !== null) {
          return true
        }
        onSubmit()
        return true
      },
    },
    {
      key: 'Meta-Backspace',
      run: () => {
        stepBack()
        return true
      },
    },
  ]
}
