import create from 'zustand'
import { addLineHighlight, EditorView } from './editor/highlightextension'

export type Range = [number, number]

type GuiModes =
  | {
      mode: 'default'
    }
  | {
      mode: 'sketch'
      sketchMode: 'points'
      axis: 'xy' | 'xz' | 'yz'
    }
  | {
      mode: 'sketch'
      sketchMode: 'selectFace'
    }
  | {
      mode: 'codeError'
    }

interface StoreState {
  editorView: EditorView | null
  setEditorView: (editorView: EditorView) => void
  highlightRange: [number, number]
  setHighlightRange: (range: Range) => void
  selectionRange: [number, number]
  setSelectionRange: (range: Range) => void
  guiMode: GuiModes
  lastGuiMode: GuiModes
  setGuiMode: (guiMode: GuiModes) => void
  removeError: () => void
  logs: string[]
  addLog: (log: string) => void
  resetLogs: () => void
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
  guiMode: { mode: 'default' },
  lastGuiMode: { mode: 'default' },
  setGuiMode: (guiMode) => {
    const lastGuiMode = get().guiMode
    set({ guiMode })
    set({ lastGuiMode })
  },
  removeError: () => {
    const lastGuiMode = get().lastGuiMode
    const currentGuiMode = get().guiMode
    if (currentGuiMode.mode === 'codeError') {
      set({ guiMode: lastGuiMode })
    }
  },
  logs: [],
  addLog: (log) => {
    set((state) => ({ logs: [...state.logs, log] }))
  },
  resetLogs: () => {
    set({ logs: [] })
  },
}))
