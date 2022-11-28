import create from 'zustand'
import { addLineHighlight, EditorView } from './editor/highlightextension'
import { Program, abstractSyntaxTree } from './lang/abstractSyntaxTree'
import { recast } from './lang/recast'
import { lexer } from './lang/tokeniser'

export type Range = [number, number]

type GuiModes =
  | {
      mode: 'default'
    }
  | {
      mode: 'sketch'
      sketchMode: 'points'
      axis: 'xy' | 'xz' | 'yz'
      id: string
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
  ast: Program | null
  setAst: (ast: Program | null) => void
  updateAst: (ast: Program) => void
  code: string
  setCode: (code: string) => void
  formatCode: () => void
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
    if (guiMode.mode !== 'codeError') {
      // don't set lastGuiMode to and error state
      // as the point fo lastGuiMode is to restore the last healthy state
      // todo maybe rename to lastHealthyGuiMode and remove this comment
      set({ lastGuiMode })
    }
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
  ast: null,
  setAst: (ast) => {
    set({ ast })
  },
  updateAst: (ast) => {
    const newCode = recast(ast)
    set({ ast, code: newCode })
  },
  code: '',
  setCode: (code) => {
    set({ code })
  },
  formatCode: () => {
    const code = get().code
    const ast = abstractSyntaxTree(lexer(code))
    const newCode = recast(ast)
    set({ code: newCode, ast })
  },
}))
