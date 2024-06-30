import { foldService } from '@codemirror/language'
import { Extension, EditorState } from '@codemirror/state'

import { LanguageServerPlugin } from './lsp'

export default function lspFoldingExt(
  plugin: LanguageServerPlugin | null
): Extension {
  return foldService.of(
    (state: EditorState, lineStart: number, lineEnd: number) => {
      // Get the folding ranges from the language server.
      // Since this is async we directly need to update the folding ranges after.
      return plugin?.foldingRange(lineStart, lineEnd) ?? null
    }
  )
}
