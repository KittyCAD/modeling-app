import type { Extension } from '@codemirror/state'
import type { ViewPlugin } from '@codemirror/view'
import { EditorView, hoverTooltip, tooltips } from '@codemirror/view'

import type { LanguageServerPlugin } from './lsp'
import { offsetToPos } from './util'

export default function lspHoverExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  return [
    hoverTooltip((view, pos) => {
      const value = view.plugin(plugin)
      return (
        value?.requestHoverTooltip(view, offsetToPos(view.state.doc, pos)) ??
        null
      )
    }),
    tooltips({
      position: 'absolute',
      parent: document.body,
    }),
    EditorView.baseTheme({
      '.cm-tooltip': {
        fontSize: '12px',
        maxWidth: '400px',
        padding: '2px',
      },
    }),
  ]
}
