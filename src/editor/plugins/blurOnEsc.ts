import { keymap } from '@codemirror/view'

export const blurOnEscape = keymap.of([
  {
    key: 'Escape',
    run: (target) => {
      debugger
      if (target.hasFocus) {
        target.contentDOM.blur()
        return true
      }
      return false
    },
  },
])
