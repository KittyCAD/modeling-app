import { indentService } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

export default function lspIndentExt(): Extension {
  // Match the indentation of the previous line (if present).
  return indentService.of((context, pos) => {
    try {
      const previousLine = context.lineAt(pos, -1)
      const previousLineText = previousLine.text.replaceAll(
        '\t',
        ' '.repeat(context.state.tabSize)
      )
      const match = previousLineText.match(/^(\s)*/)
      if (match === null || match.length <= 0) return null
      return match[0].length
    } catch (err) {
      console.error('Error in codemirror indentService', err)
    }
    return null
  })
}
