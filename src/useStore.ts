import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addLineHighlight, EditorView } from './editor/highlightextension'
import { parser_wasm } from './lang/abstractSyntaxTree'
import { Program } from './lang/abstractSyntaxTreeTypes'
import { getNodeFromPath } from './lang/queryAst'
import {
  ProgramMemory,
  Position,
  PathToNode,
  Rotation,
  SourceRange,
} from './lang/executor'
import { recast } from './lang/recast'
import { EditorSelection } from '@codemirror/state'
import {
  ArtifactMap,
  SourceRangeMap,
  EngineCommandManager,
} from './lang/std/engineConnection'
import { KCLError } from './lang/errors'

export type Selection = {
  type: 'default' | 'line-end' | 'line-mid'
  range: SourceRange
}
export type Selections = {
  otherSelections: ('y-axis' | 'x-axis' | 'z-axis')[]
  codeBasedSelections: Selection[]
}
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
  | 'angledLineThatIntersects'

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
  'angledLineThatIntersects',
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

export const baseUnits = {
  imperial: ['in', 'ft'],
  metric: ['mm', 'cm', 'm'],
} as const

export type BaseUnit = 'in' | 'ft' | 'mm' | 'cm' | 'm'

export const baseUnitsUnion = Object.values(baseUnits).flatMap((v) => v)

export type PaneType = 'code' | 'variables' | 'debug' | 'kclErrors' | 'logs'

export interface StoreState {
  editorView: EditorView | null
  setEditorView: (editorView: EditorView) => void
  highlightRange: [number, number]
  setHighlightRange: (range: Selection['range']) => void
  setCursor: (selections: Selections) => void
  setCursor2: (a?: Selection) => void
  selectionRanges: Selections
  selectionRangeTypeMap: { [key: number]: Selection['type'] }
  setSelectionRanges: (range: Selections) => void
  guiMode: GuiModes
  lastGuiMode: GuiModes
  setGuiMode: (guiMode: GuiModes) => void
  logs: string[]
  addLog: (log: string) => void
  resetLogs: () => void
  kclErrors: KCLError[]
  addKCLError: (err: KCLError) => void
  resetKCLErrors: () => void
  ast: Program | null
  setAst: (ast: Program | null) => void
  updateAst: (
    ast: Program,
    optionalParams?: {
      focusPath?: PathToNode
      callBack?: (ast: Program) => void
    }
  ) => void
  updateAstAsync: (ast: Program, focusPath?: PathToNode) => void
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
  isShiftDown: boolean
  setIsShiftDown: (isShiftDown: boolean) => void
  artifactMap: ArtifactMap
  sourceRangeMap: SourceRangeMap
  setArtifactNSourceRangeMaps: (a: {
    artifactMap: ArtifactMap
    sourceRangeMap: SourceRangeMap
  }) => void
  engineCommandManager?: EngineCommandManager
  setEngineCommandManager: (engineCommandManager: EngineCommandManager) => void
  mediaStream?: MediaStream
  setMediaStream: (mediaStream: MediaStream) => void
  isStreamReady: boolean
  setIsStreamReady: (isStreamReady: boolean) => void
  isMouseDownInStream: boolean
  setIsMouseDownInStream: (isMouseDownInStream: boolean) => void
  didDragInStream: boolean
  setDidDragInStream: (didDragInStream: boolean) => void
  fileId: string
  setFileId: (fileId: string) => void
  streamDimensions: { streamWidth: number; streamHeight: number }
  setStreamDimensions: (dimensions: {
    streamWidth: number
    streamHeight: number
  }) => void

  showHomeMenu: boolean
  setHomeShowMenu: (showMenu: boolean) => void
  isBannerDismissed: boolean
  setBannerDismissed: (isBannerDismissed: boolean) => void
  openPanes: PaneType[]
  setOpenPanes: (panes: PaneType[]) => void
  homeMenuItems: {
    name: string
    path: string
  }[]
  setHomeMenuItems: (items: { name: string; path: string }[]) => void
}

let pendingAstUpdates: number[] = []

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      editorView: null,
      setEditorView: (editorView) => {
        set({ editorView })
      },
      highlightRange: [0, 0],
      setHighlightRange: (selection) => {
        set({ highlightRange: selection })
        const editorView = get().editorView
        if (editorView) {
          editorView.dispatch({ effects: addLineHighlight.of(selection) })
        }
      },
      setCursor: (selections) => {
        const { editorView } = get()
        if (!editorView) return
        const ranges: ReturnType<typeof EditorSelection.cursor>[] = []
        const selectionRangeTypeMap: { [key: number]: Selection['type'] } = {}
        set({ selectionRangeTypeMap })
        selections.codeBasedSelections.forEach(({ range, type }) => {
          if (range?.[1]) {
            ranges.push(EditorSelection.cursor(range[1]))
            selectionRangeTypeMap[range[1]] = type
          }
        })
        setTimeout(() => {
          editorView.dispatch({
            selection: EditorSelection.create(
              ranges,
              selections.codeBasedSelections.length - 1
            ),
          })
        })
      },
      setCursor2: (codeSelections) => {
        const currestSelections = get().selectionRanges
        const code = get().code
        if (!codeSelections) {
          get().setCursor({
            otherSelections: currestSelections.otherSelections,
            codeBasedSelections: [
              { range: [0, code.length - 1], type: 'default' },
            ],
          })
          return
        }
        const selections: Selections = {
          ...currestSelections,
          codeBasedSelections: get().isShiftDown
            ? [...currestSelections.codeBasedSelections, codeSelections]
            : [codeSelections],
        }
        get().setCursor(selections)
      },
      selectionRangeTypeMap: {},
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      },
      setSelectionRanges: (selectionRanges) =>
        set({ selectionRanges, selectionRangeTypeMap: {} }),
      guiMode: { mode: 'default' },
      lastGuiMode: { mode: 'default' },
      setGuiMode: (guiMode) => {
        set({ guiMode })
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
      kclErrors: [],
      addKCLError: (e) => {
        set((state) => ({ kclErrors: [...state.kclErrors, e] }))
      },
      resetKCLErrors: () => {
        set({ kclErrors: [] })
      },
      ast: null,
      setAst: (ast) => {
        set({ ast })
      },
      updateAst: async (ast, { focusPath, callBack = () => {} } = {}) => {
        const newCode = recast(ast)
        const astWithUpdatedSource = parser_wasm(newCode)
        callBack(astWithUpdatedSource)

        set({ ast: astWithUpdatedSource, code: newCode })
        if (focusPath) {
          const { node } = getNodeFromPath<any>(astWithUpdatedSource, focusPath)
          const { start, end } = node
          if (!start || !end) return
          setTimeout(() => {
            get().setCursor({
              codeBasedSelections: [
                {
                  type: 'default',
                  range: [start, end],
                },
              ],
              otherSelections: [],
            })
          })
        }
      },
      updateAstAsync: async (ast, focusPath) => {
        // clear any pending updates
        pendingAstUpdates.forEach((id) => clearTimeout(id))
        pendingAstUpdates = []
        // setup a new update
        pendingAstUpdates.push(
          setTimeout(() => {
            get().updateAst(ast, { focusPath })
          }, 100) as unknown as number
        )
      },
      code: '',
      setCode: (code) => {
        set({ code })
      },
      formatCode: async () => {
        const code = get().code
        const ast = parser_wasm(code)
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
      programMemory: { root: {}, pendingMemory: {} },
      setProgramMemory: (programMemory) => set({ programMemory }),
      isShiftDown: false,
      setIsShiftDown: (isShiftDown) => set({ isShiftDown }),
      artifactMap: {},
      sourceRangeMap: {},
      setArtifactNSourceRangeMaps: (maps) => set({ ...maps }),
      setEngineCommandManager: (engineCommandManager) =>
        set({ engineCommandManager }),
      setMediaStream: (mediaStream) => set({ mediaStream }),
      isStreamReady: false,
      setIsStreamReady: (isStreamReady) => set({ isStreamReady }),
      isMouseDownInStream: false,
      setIsMouseDownInStream: (isMouseDownInStream) => {
        set({ isMouseDownInStream })
      },
      didDragInStream: false,
      setDidDragInStream: (didDragInStream) => {
        set({ didDragInStream })
      },
      // For stream event handling
      fileId: '',
      setFileId: (fileId) => set({ fileId }),
      streamDimensions: { streamWidth: 1280, streamHeight: 720 },
      setStreamDimensions: (streamDimensions) => set({ streamDimensions }),

      // tauri specific app settings
      defaultDir: {
        dir: '',
      },
      isBannerDismissed: false,
      setBannerDismissed: (isBannerDismissed) => set({ isBannerDismissed }),
      openPanes: ['code'],
      setOpenPanes: (openPanes) => set({ openPanes }),
      showHomeMenu: true,
      setHomeShowMenu: (showHomeMenu) => set({ showHomeMenu }),
      homeMenuItems: [],
      setHomeMenuItems: (homeMenuItems) => set({ homeMenuItems }),
    }),
    {
      name: 'store',
      partialize: (state) =>
        Object.fromEntries(
          Object.entries(state).filter(([key]) =>
            ['code', 'openPanes'].includes(key)
          )
        ),
    }
  )
)
