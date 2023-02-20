import create from 'zustand'
import { addLineHighlight, EditorView } from './editor/highlightextension'
import {
  Program,
  abstractSyntaxTree,
  getNodeFromPath,
} from './lang/abstractSyntaxTree'
import { ProgramMemory, Position, PathToNode, Rotation } from './lang/executor'
import { recast } from './lang/recast'
import { asyncLexer } from './lang/tokeniser'

export type Range = [number, number]
export type TooTip =
  | 'lineTo'
  | 'line'
  | 'angledLine'
  | 'angledLineOfXLength'
  | 'angledLineOfYLength'
  | 'angledLineToX'
  | 'angledLineToY'
  | 'xLine'
  | 'yLine'
  | 'xLineTo'
  | 'yLineTo'

export const toolTips: TooTip[] = [
  'lineTo',
  'line',
  'angledLine',
  'angledLineOfXLength',
  'angledLineOfYLength',
  'angledLineToX',
  'angledLineToY',
  'xLine',
  'yLine',
  'xLineTo',
  'yLineTo',
]

export type GuiModes =
  | {
      mode: 'default'
    }
  | {
      mode: 'sketch'
      sketchMode: TooTip
      isTooltip: true
      rotation: Rotation
      position: Position
      id?: string
      pathToNode: PathToNode
    }
  | {
      mode: 'sketch'
      sketchMode: 'sketchEdit'
      isTooltip: true
      rotation: Rotation
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
      rotation: Rotation
      position: Position
    }
  | {
      mode: 'canEditExtrude'
      pathToNode: PathToNode
      rotation: Rotation
      position: Position
    }

interface StoreState {
  editorView: EditorView | null
  setEditorView: (editorView: EditorView) => void
  highlightRange: [number, number]
  setHighlightRange: (range: Range) => void
  setCursor: (start: number, end?: number) => void
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
  updateAst: (ast: Program, focusPath?: PathToNode) => void
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
  setCursor: (start: number, end: number = start) => {
    const editorView = get().editorView
    if (!editorView) return
    editorView.dispatch({
      selection: { anchor: start, head: end },
    })
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
    if (Array.isArray(log)) {
      const cleanLog: any = log.map(({ __geoMeta, ...rest }) => rest)
      set((state) => ({ logs: [...state.logs, cleanLog] }))
    } else {
      set((state) => ({ logs: [...state.logs, log] }))
    }
  },
  resetLogs: () => {
    set({ logs: [] })
  },
  ast: null,
  setAst: (ast) => {
    set({ ast })
  },
  updateAst: async (ast, focusPath) => {
    const newCode = recast(ast)
    const astWithUpdatedSource = abstractSyntaxTree(await asyncLexer(newCode))

    set({ ast: astWithUpdatedSource, code: newCode })
    if (focusPath) {
      const { node } = getNodeFromPath<any>(astWithUpdatedSource, focusPath)
      const { start, end } = node
      if (!start || !end) return
      setTimeout(() => {
        get().setCursor(start, end)
      })
    }
  },
  code: '',
  setCode: (code) => {
    set({ code })
  },
  formatCode: async () => {
    const code = get().code
    const ast = abstractSyntaxTree(await asyncLexer(code))
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
