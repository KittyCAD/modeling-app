import fsZds from '@src/lib/fs-zds'
import type { Editor } from '@src/lib/editors/registry/contract'

/** Classification only inspects source data, so it cannot depend on the capabilities it enables. */
export interface EditorSourceContext {
  readonly src: string
  readonly contents: string
}

/** A source snapshot shared by editor behavior, execution, and view matching. */
export interface EditorMatchContext extends EditorSourceContext {
  readonly documentType?: string
  readonly languageId?: string
  readonly mediaType?: string
}

/** Predicates are synchronous, pure, and should be inexpensive; outputs never affect matching. */
export type EditorMatcher =
  | '*'
  | `.${string}`
  | ((context: EditorMatchContext) => boolean)

export function editorMatchContext(editor: Editor): EditorMatchContext {
  // Unnamed buffers have no file extension; wildcard and content predicates still apply.
  return {
    src: editor.src.value ?? '',
    documentType: editor.documentType,
    contents: editor.contents.value,
    ...editor.classification.value,
  }
}

export function matchesEditor(
  matcher: EditorMatcher,
  context: EditorMatchContext
): boolean {
  if (typeof matcher === 'function') return matcher(context)
  return (
    matcher === '*' ||
    matcher.toLowerCase() === fsZds.extname(context.src).toLowerCase()
  )
}
