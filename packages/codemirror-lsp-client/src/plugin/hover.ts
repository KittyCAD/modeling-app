import { Extension } from '@codemirror/state'
import { hoverTooltip, tooltips } from '@codemirror/view'

import { LanguageServerPlugin } from './lsp'
import { offsetToPos } from './util'

export default function lspHoverExt(
  plugin: LanguageServerPlugin | null
): Extension {
  return [
    hoverTooltip(
      (view, pos) =>
        plugin?.requestHoverTooltip(view, offsetToPos(view.state.doc, pos)) ??
        null
    ),
    tooltips({
      position: 'absolute',
    }),
  ]
}
