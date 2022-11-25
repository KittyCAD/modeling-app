import create from 'zustand'
import { addLineHighlight, EditorView } from './editor/highlightextension'

export type Range = [number, number]

interface StoreState {
  editorView: EditorView | null
  setEditorView: (editorView: EditorView) => void
  highlightRange: [number, number]
  setHighlightRange: (range: Range) => void
  selectionRange: [number, number]
  setSelectionRange: (range: Range) => void
}

export const useStore = create<StoreState>()((set, get) => ({
  editorView: null,
  setEditorView: (editorView) => {
    set({ editorView })
  },
  highlightRange: [0, 0],
  setHighlightRange: (highlightRange) => {
    set({ highlightRange })
    const editorView = get().editorView
    if (editorView) {
      editorView.dispatch({ effects: addLineHighlight.of(highlightRange) })
    }
  },
  selectionRange: [0, 0],
  setSelectionRange: (selectionRange) => {
    set({ selectionRange })
  },
}))
