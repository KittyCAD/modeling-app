import type {
  EditorBacking,
  EditorFileFormat,
} from '@src/lib/editors/registry/contract'
import fsZds from '@src/lib/fs-zds'

/** Only the text case can initialize an editable document; binary bytes are never decoded. */
export type EditorInput =
  | { type: 'text'; contents: string }
  | { type: 'binary'; bytes: Uint8Array }

export function parseEditorFile(
  src: string,
  bytes: Uint8Array,
  formats: readonly EditorFileFormat[]
): EditorInput {
  const format = formats
    .filter(({ matches }) =>
      typeof matches === 'function'
        ? matches(src)
        : fsZds.extname(src).toLowerCase() === matches.toLowerCase()
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
  if (format?.type === 'text') {
    try {
      const contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (!contents.includes('\0')) return { type: 'text', contents }
    } catch {
      // A text extension cannot make an invalid UTF-8 file safe to rewrite as text.
    }
  }
  return { type: 'binary', bytes }
}

/** Keep a private byte snapshot so callers cannot mutate the backing through either buffer. */
export function createEditorBacking(input: EditorInput): EditorBacking {
  if (input.type === 'text') return { type: 'text' }
  const bytes = input.bytes.slice()
  return { type: 'binary', readBytes: () => bytes.slice() }
}
