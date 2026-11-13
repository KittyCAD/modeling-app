import type { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { MarkedOptions } from '@ts-stack/markdown'
import { Marked } from '@ts-stack/markdown'
import type * as LSP from 'vscode-languageserver-protocol'

import { isArray } from '../lib/utils'

export function posToOffset(
  doc: Text,
  pos: { line: number; character: number }
): number | undefined {
  if (pos.line >= doc.lines) return
  const offset = doc.line(pos.line + 1).from + pos.character
  if (offset > doc.length) return
  return offset
}

export function posToOffsetOrZero(
  doc: Text,
  pos: { line: number; character: number }
): number {
  return posToOffset(doc, pos) || 0
}

export function offsetToPos(doc: Text, offset: number) {
  const line = doc.lineAt(offset)
  return {
    line: line.number - 1,
    character: offset - line.from,
  }
}

const markedOptions: MarkedOptions = {
  gfm: true,
  sanitize: true,
}

export function isLSPTextEdit(
  textEdit?: LSP.TextEdit | LSP.InsertReplaceEdit
): textEdit is LSP.TextEdit {
  return (textEdit as LSP.TextEdit)?.range !== undefined
}

export function isLSPMarkupContent(
  contents: LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[]
): contents is LSP.MarkupContent {
  return (contents as LSP.MarkupContent).kind !== undefined
}

export function formatContents(
  contents:
    | LSP.MarkupContent
    | LSP.MarkedString
    | LSP.MarkedString[]
    | undefined
): string {
  if (!contents) {
    return ''
  }
  if (isLSPMarkupContent(contents)) {
    let value = contents.value
    if (contents.kind === 'markdown') {
      value = Marked.parse(value, markedOptions)
    }
    return value
  }
  if (isArray(contents)) {
    return contents
      .map((c) => formatContents(c))
      .filter(Boolean)
      .join('\n\n')
  }
  if (typeof contents === 'string') {
    return contents
  }
  if (
    typeof contents === 'object' &&
    'language' in contents &&
    'value' in contents
  ) {
    return contents.value
  }
  return ''
}

export function showErrorMessage(view: EditorView, message: string) {
  const tooltip = document.createElement('div')
  tooltip.className = 'cm-error-message'
  tooltip.style.cssText = `
  position: absolute;
  padding: 8px;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 4px;
  color: #c00;
  font-size: 14px;
  z-index: 100;
  max-width: 300px;
  box-shadow: 0 2px 8px rgba(0,0,0,.15);
`
  tooltip.textContent = message

  // Position near the cursor
  const cursor = view.coordsAtPos(view.state.selection.main.head)
  if (cursor) {
    tooltip.style.left = `${cursor.left}px`
    tooltip.style.top = `${cursor.bottom + 5}px`
  }

  document.body.appendChild(tooltip)

  // zds-performance-exception: feedback-lifetime -- Keep the immediately shown error readable for three seconds, then remove it without a fade.
  setTimeout(() => {
    tooltip.remove()
  }, 3000)
}
