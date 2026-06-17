import {
  type EditorView,
  closeHoverTooltips,
  hasHoverTooltips,
  keymap,
} from '@codemirror/view'

export const blurOnEscape = keymap.of([
  {
    key: 'Escape',
    run: (target) => {
      // First ESC closes any hover tooltips currently open
      if (hasHoverTooltips(target.state)) {
        target.dispatch({ effects: closeHoverTooltips })
        removeLintTooltipDom(target)
        return true
      }

      // Try closing any gutter tooltips
      if (removeLintTooltipDom(target)) {
        return true
      }

      // No tooltips were closed, blur out of current focus

      if (target.hasFocus) {
        target.contentDOM.blur()
        return true
      }
      return false
    },
  },
])

//
function removeLintTooltipDom(view: EditorView): boolean {
  const tooltips = Array.from(
    view.dom.ownerDocument.querySelectorAll<HTMLElement>('.cm-tooltip-lint')
  )
  if (tooltips.length) {
    tooltips.forEach((tooltip) => tooltip.remove())
    return true
  }
  return false
}
