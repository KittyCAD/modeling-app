import { isRecord } from '@src/lib/utils'
import type { Editor } from '@src/lib/editors/registry/contract'
import { documentChanges } from '@src/lib/editors/changes'

export function parseArgumentDocument(
  contents: string
): Record<string, unknown> | Error {
  try {
    const value: unknown = JSON.parse(contents)
    return isRecord(value)
      ? value
      : new Error('Command arguments must be a JSON object.')
  } catch (cause) {
    return new Error(
      'Fix the JSON in Code mode to edit or submit these arguments.',
      { cause }
    )
  }
}
/** Form edits patch the same document and history as Code mode, without resetting malformed input. */
export function setArgument(editor: Editor, name: string, value: unknown) {
  const values = parseArgumentDocument(editor.contents.peek())
  if (values instanceof Error) return values
  if (JSON.stringify(values[name]) === JSON.stringify(value)) return
  const contents = JSON.stringify({ ...values, [name]: value }, null, 2)
  editor.view.dispatch({
    changes: documentChanges(editor.view.state.doc, contents),
    userEvent: 'input.form',
  })
}
