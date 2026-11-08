import { Compartment } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'
import { editorVisualTheme } from '@src/editor/plugins/theme'

/** Follow the app's resolved theme, including detached buffers, without owning app settings. */
export function editorAppearance() {
  const resolvedTheme = () =>
    document.body.classList.contains('dark') ||
    document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light'
  const theme = new Compartment()
  return [
    theme.of(editorVisualTheme[resolvedTheme()]),
    ViewPlugin.define((view) => {
      let current = resolvedTheme()
      const observer = new MutationObserver(() => {
        const next = resolvedTheme()
        if (next === current) return
        current = next
        view.dispatch({ effects: theme.reconfigure(editorVisualTheme[next]) })
      })
      const options = { attributes: true, attributeFilter: ['class'] }
      observer.observe(document.body, options)
      observer.observe(document.documentElement, options)
      return { destroy: () => observer.disconnect() }
    }),
  ]
}
