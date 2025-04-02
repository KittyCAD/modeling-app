import type { Text } from '@codemirror/state'
import type { MarkedOptions } from '@ts-stack/markdown'
import { Marked } from '@ts-stack/markdown'
import type * as LSP from 'vscode-languageserver-protocol'

import { isArray } from '../lib/utils'

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

const markedOptions: MarkedOptions = {
  gfm: true,
}

export function formatMarkdownContents(
  contents: LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[]
): string {
  if (isArray(contents)) {
    return contents.map((c) => formatMarkdownContents(c) + '\n\n').join('')
  } else if (typeof contents === 'string') {
    return Marked.parse(contents, markedOptions)
  } else {
    return Marked.parse(contents.value, markedOptions)
  }
}
