import { Text } from '@codemirror/state'
import { Marked } from '@ts-stack/markdown'

import type * as LSP from 'vscode-languageserver-protocol'

// takes a function and executes it after the wait time, if the function is called again before the wait time is up, the timer is reset
export function deferExecution<T>(func: (args: T) => any, wait: number) {
  let timeout: ReturnType<typeof setTimeout> | null
  let latestArgs: T

  function later() {
    timeout = null
    func(latestArgs)
  }

  function deferred(args: T) {
    latestArgs = args
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(later, wait)
  }

  return deferred
}

export function posToOffset(
  doc: Text,
  pos: { line: number; character: number }
): number | undefined {
  if (pos.line >= doc.lines) return
  const offset = doc.line(pos.line + 1).from + pos.character
  if (offset > doc.length) return
  return offset
}

export function offsetToPos(doc: Text, offset: number) {
  const line = doc.lineAt(offset)
  return {
    line: line.number - 1,
    character: offset - line.from,
  }
}

export function formatMarkdownContents(
  contents: LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[]
): string {
  if (Array.isArray(contents)) {
    return contents.map((c) => formatMarkdownContents(c) + '\n\n').join('')
  } else if (typeof contents === 'string') {
    return Marked.parse(contents)
  } else {
    return Marked.parse(contents.value)
  }
}
