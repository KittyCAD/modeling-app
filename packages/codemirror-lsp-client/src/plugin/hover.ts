import { Extension } from '@codemirror/state'
import { hoverTooltip, tooltips, ViewPlugin } from '@codemirror/view'

import { LanguageServerPlugin } from './lsp'
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
    }),
  ]
}
