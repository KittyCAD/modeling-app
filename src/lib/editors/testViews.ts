import type { Editor, EditorsService } from '@src/lib/editors/registry/contract'
import { assert } from 'vitest'

/** Fail a success-path fixture at the operation that returned an error. */
export function requireSuccess<T>(result: T | Error): T {
  if (result instanceof Error) assert.fail(result.message)
  return result
}

export function presentation(editors: EditorsService, editor: Editor) {
  return (
    editors.views.peek().find((view) => view.editor === editor) ??
    requireSuccess(editors.createView(editor))
  )
}
export function codeSurface(editors: EditorsService, editor: Editor) {
  return (
    editors.views
      .peek()
      .find((view) => view.editor === editor && view.codeView.peek())
      ?.codeView.peek() ??
    requireSuccess(editors.createView(editor, 'editors.code')).codeView.peek()!
  )
}
