import { keymap } from '@codemirror/view'

export const blurOnEscape = keymap.of([
  {
    key: 'Escape',
    run: (target) => {
      if (target.hasFocus) {
        target.contentDOM.blur()
        return true
      }
      return false
    },
  },
])
