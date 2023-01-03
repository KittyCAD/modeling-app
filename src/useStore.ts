import create from 'zustand'
import { addLineHighlight, EditorView } from './editor/highlightextension'
import { Program, abstractSyntaxTree } from './lang/abstractSyntaxTree'
import { ProgramMemory } from './lang/executor'
import { recast } from './lang/recast'
import { lexer } from './lang/tokeniser'
import { Quaternion } from 'three'

export type Range = [number, number]

type PathToNode = (string | number)[]
type Position = [number, number, number]

type GuiModes =
  | {
      mode: 'default'
    }
  | {
      mode: 'sketch'
      sketchMode: 'points'
      quaternion: Quaternion
      position: Position
      id?: string
      pathToNode: PathToNode
    }
  | {
      mode: 'sketch'
      sketchMode: 'sketchEdit'
      quaternion: Quaternion
      position: Position
      pathToNode: PathToNode
    }
  | {
      mode: 'sketch'
      sketchMode: 'selectFace'
    }
  | {
      mode: 'canEditSketch'
      pathToNode: PathToNode
      quaternion: Quaternion
      position: Position
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
  errorState: {
    isError: boolean
    error: string
  }
  setError: (error?: string) => void
  programMemory: ProgramMemory
  setProgramMemory: (programMemory: ProgramMemory) => void
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
  },
  removeError: () => {
    const lastGuiMode = get().lastGuiMode
    const currentGuiMode = get().guiMode
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
  errorState: {
    isError: false,
    error: '',
  },
  setError: (error = '') => {
    set({ errorState: { isError: !!error, error } })
  },
  programMemory: { root: {}, _sketch: [] },
  setProgramMemory: (programMemory) => set({ programMemory }),
}))
