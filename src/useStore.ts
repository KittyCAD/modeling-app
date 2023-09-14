import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addLineHighlight, EditorView } from './editor/highlightextension'
import { parser_wasm } from './lang/abstractSyntaxTree'
import { Program } from './lang/abstractSyntaxTreeTypes'
import { getNodeFromPath } from './lang/queryAst'
import { enginelessExecutor } from './lib/testHelpers'
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
import { deferExecution } from 'lib/utils'
import { _executor } from './lang/executor'

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

export const toolTips = [
  'sketch_line',
  'move',
  // original tooltips
  'line',
  'lineTo',
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
] as any as TooTip[]

export type GuiModes =
  | {
      mode: 'default'
    }
  | {
      mode: 'sketch'
      sketchMode: TooTip
      isTooltip: true
      waitingFirstClick: boolean
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
      pathId: string
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

export type PaneType =
  | 'code'
  | 'variables'
  | 'debug'
  | 'kclErrors'
  | 'logs'
  | 'lspMessages'

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
  ast: Program
  setAst: (ast: Program) => void
  executeAst: () => void
  executeAstMock: () => void
  updateAst: (
    ast: Program,
    execute: boolean,
    optionalParams?: {
      focusPath?: PathToNode
      callBack?: (ast: Program) => void
    }
  ) => void
  updateAstAsync: (
    ast: Program,
    reexecute: boolean,
    focusPath?: PathToNode
  ) => void
  code: string
  setCode: (code: string) => void
  deferredSetCode: (code: string) => void
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
  isLSPServerReady: boolean
  setIsLSPServerReady: (isLSPServerReady: boolean) => void
  buttonDownInStream: number | undefined
  setButtonDownInStream: (buttonDownInStream: number | undefined) => void
  didDragInStream: boolean
  setDidDragInStream: (didDragInStream: boolean) => void
  fileId: string
  setFileId: (fileId: string) => void
  streamDimensions: { streamWidth: number; streamHeight: number }
  setStreamDimensions: (dimensions: {
    streamWidth: number
    streamHeight: number
  }) => void
  isExecuting: boolean
  setIsExecuting: (isExecuting: boolean) => void

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
    (set, get) => {
      const setDeferredCode = deferExecution((code: string) => {
        // We defer this so that likely our ast has caught up to the code.
        // If we are making changes that are not reflected in the ast, we
        // should not be updating the ast.

        // Let's parse the ast.
        const ast = parser_wasm(code)
        // Check if the ast we have is equal to the ast in the storage.
        // If it is, we don't need to update the ast.
        if (JSON.stringify(ast) === JSON.stringify(get().ast)) return
        // If it isn't, we need to update the ast and execute.
        // We do not call updateAst directly because we don't want to move the
        // cursor when the user is typing.
        get().setAst(ast)
        get().executeAst()
      }, 600)
      return {
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
            ranges.length &&
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
        ast: {
          start: 0,
          end: 0,
          body: [],
          nonCodeMeta: {
            noneCodeNodes: {},
            start: null,
          },
        },
        setAst: (ast) => {
          set({ ast })
        },
        executeAst: async () => {
          if (!get().isStreamReady) return
          if (!get().engineCommandManager) return
          let unsubFn: any[] = []

          const engineCommandManager = get().engineCommandManager!
          // We assume we have already set the ast.
          try {
            get().resetLogs()
            get().resetKCLErrors()

            engineCommandManager.endSession()
            engineCommandManager.startNewSession()
            get().setIsExecuting(true)
            const programMemory = await _executor(
              get().ast,
              {
                root: {
                  _0: {
                    type: 'UserVal',
                    value: 0,
                    __meta: [],
                  },
                  _90: {
                    type: 'UserVal',
                    value: 90,
                    __meta: [],
                  },
                  _180: {
                    type: 'UserVal',
                    value: 180,
                    __meta: [],
                  },
                  _270: {
                    type: 'UserVal',
                    value: 270,
                    __meta: [],
                  },
                },
                return: null,
              },
              engineCommandManager
            )

            const { artifactMap, sourceRangeMap } =
              await engineCommandManager.waitForAllCommands(
                get().ast,
                programMemory
              )
            get().setIsExecuting(false)
            if (programMemory !== undefined) {
              get().setProgramMemory(programMemory)
            }

            get().setArtifactNSourceRangeMaps({ artifactMap, sourceRangeMap })
            const unSubHover = engineCommandManager.subscribeToUnreliable({
              event: 'highlight_set_entity',
              callback: ({ data }) => {
                if (data?.entity_id) {
                  const sourceRange = sourceRangeMap[data.entity_id]
                  get().setHighlightRange(sourceRange)
                } else if (
                  !get().highlightRange ||
                  (get().highlightRange[0] !== 0 &&
                    get().highlightRange[1] !== 0)
                ) {
                  get().setHighlightRange([0, 0])
                }
              },
            })
            const unSubClick = engineCommandManager.subscribeTo({
              event: 'select_with_point',
              callback: ({ data }) => {
                if (!data?.entity_id) {
                  get().setCursor2()
                  return
                }
                const sourceRange = sourceRangeMap[data.entity_id]
                get().setCursor2({ range: sourceRange, type: 'default' })
              },
            })
            unsubFn.push(unSubHover, unSubClick)

            get().setError()
          } catch (e: any) {
            get().setIsExecuting(false)
            if (e instanceof KCLError) {
              get().addKCLError(e)
            } else {
              get().setError('problem')
              console.log(e)
              get().addLog(e)
            }
          }
        },
        executeAstMock: async () => {
          if (!get().isStreamReady) return

          // We assume we have already set the ast and updated the code.
          try {
            get().resetLogs()
            get().resetKCLErrors()

            // Get the mock executor.
            const programMemory = await enginelessExecutor(get().ast, {
              root: {
                _0: {
                  type: 'UserVal',
                  value: 0,
                  __meta: [],
                },
                _90: {
                  type: 'UserVal',
                  value: 90,
                  __meta: [],
                },
                _180: {
                  type: 'UserVal',
                  value: 180,
                  __meta: [],
                },
                _270: {
                  type: 'UserVal',
                  value: 270,
                  __meta: [],
                },
              },
              return: null,
            })

            if (programMemory !== undefined) {
              get().setProgramMemory(programMemory)
            }
            get().setError()
          } catch (e: any) {
            if (e instanceof KCLError) {
              get().addKCLError(e)
            } else {
              get().setError('problem')
              console.log(e)
              get().addLog(e)
            }
          }
        },
        updateAst: async (
          ast,
          reexecute,
          { focusPath, callBack = () => {} } = {}
        ) => {
          const newCode = recast(ast)
          const astWithUpdatedSource = parser_wasm(newCode)
          callBack(astWithUpdatedSource)

          set({
            ast: astWithUpdatedSource,
            code: newCode,
          })
          if (focusPath) {
            const { node } = getNodeFromPath<any>(
              astWithUpdatedSource,
              focusPath
            )
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

          if (reexecute) {
            // Call execute on the set ast.
            get().executeAst()
          } else {
            // When we don't re-execute, we still want to update the program
            // memory with the new ast. So we will hit the mock executor
            // instead.
            get().executeAstMock()
          }
        },
        updateAstAsync: async (ast, reexecute, focusPath) => {
          // clear any pending updates
          pendingAstUpdates.forEach((id) => clearTimeout(id))
          pendingAstUpdates = []
          // setup a new update
          pendingAstUpdates.push(
            setTimeout(() => {
              get().updateAst(ast, reexecute, { focusPath })
            }, 100) as unknown as number
          )
        },
        code: '',
        setCode: (code) => set({ code }),
        deferredSetCode: (code) => {
          set({ code })
          setDeferredCode(code)
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
        programMemory: { root: {}, return: null },
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
        isLSPServerReady: false,
        setIsLSPServerReady: (isLSPServerReady) => set({ isLSPServerReady }),
        buttonDownInStream: undefined,
        setButtonDownInStream: (buttonDownInStream) => {
          set({ buttonDownInStream })
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
        isExecuting: false,
        setIsExecuting: (isExecuting) => set({ isExecuting }),

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
      }
    },
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
