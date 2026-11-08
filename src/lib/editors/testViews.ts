import type { Editor, EditorsService } from '@src/lib/editors/registry/contract'

export function presentation(editors: EditorsService, editor: Editor) {
  return (
    editors.views.peek().find((view) => view.editor === editor) ??
    editors.createView(editor)
  )
}
export function codeSurface(editors: EditorsService, editor: Editor) {
  return (
    editors.views
      .peek()
      .find((view) => view.editor === editor && view.codeView.peek())
      ?.codeView.peek() ??
    presentation(editors, editor).codeView.peek() ??
    editors.createView(editor, 'editors.code').codeView.peek()!
  )
}
