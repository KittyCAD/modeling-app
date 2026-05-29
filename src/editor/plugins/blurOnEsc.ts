import { closeHoverTooltips, hasHoverTooltips, keymap } from '@codemirror/view'

export const blurOnEscape = keymap.of([
  {
    key: 'Escape',
    run: (target) => {
      if (hasHoverTooltips(target.state)) {
        target.dispatch({ effects: closeHoverTooltips })
        return true
      }

      if (target.hasFocus) {
        target.contentDOM.blur()
        return true
      }
      return false
    },
  },
])
