import type { EditorView } from '@codemirror/view'

export type KclLspEditor = {
  path: string
  editorView: EditorView
  clearGlobalHistory: () => void
}
