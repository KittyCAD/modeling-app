import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addLineHighlight, EditorView } from './editor/highlightextension'
import {
  parse,
  Program,
  _executor,
  recast,
  ProgramMemory,
  Position,
  PathToNode,
  Rotation,
  SourceRange,
} from './lang/wasm'
import { getNodeFromPath } from './lang/queryAst'
import { enginelessExecutor } from './lib/testHelpers'
import { EditorSelection } from '@codemirror/state'
import { EngineCommandManager } from './lang/std/engineConnection'
import { KCLError } from './lang/errors'
import { deferExecution } from 'lib/utils'
import { bracket } from 'lib/exampleKcl'
import { engineCommandManager } from './lang/std/engineConnection'

export type Selection = {
  type: 'default' | 'line-end' | 'line-mid'
  range?: SourceRange
}
export type Selections = {
  otherSelections: ('y-axis' | 'x-axis' | 'z-axis')[]
  codeBasedSelections: Selection[]
}
export type ToolTip =
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
] as any as ToolTip[]

export type GuiModes =
  | {
      mode: 'default'
    }
  | {
      mode: 'sketch'
      sketchMode: ToolTip
      isTooltip: true
      waitingFirstClick: boolean
      rotation: Rotation
      position: Position
      pathId: string
      pathToNode: PathToNode
    }
  | {
      mode: 'sketch'
      sketchMode: 'sketchEdit'
      rotation: Rotation
      position: Position
      pathToNode: PathToNode
      pathId: string
    }
  | {
      mode: 'sketch'
      sketchMode: 'enterSketchEdit'
      rotation: Rotation
      position: Position
      pathToNode: PathToNode
      pathId: string
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
  setLogs: (logs: string[]) => void
  kclErrors: KCLError[]
  addKCLError: (err: KCLError) => void
  setErrors: (errors: KCLError[]) => void
  resetKCLErrors: () => void
  ast: Program
  setAst: (ast: Program) => void
  executeAst: (ast?: Program) => void
  executeAstMock: (ast?: Program) => void
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
  executeCode: (code?: string, force?: boolean) => void
  formatCode: () => void
  programMemory: ProgramMemory
  setProgramMemory: (programMemory: ProgramMemory) => void
  isShiftDown: boolean
  setIsShiftDown: (isShiftDown: boolean) => void
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
      // We defer this so that likely our ast has caught up to the code.
      // If we are making changes that are not reflected in the ast, we
      // should not be updating the ast.
      const setDeferredCode = deferExecution((code: string) => {
        set({ code })
        get().executeCode(code)
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
        executeCode: async (code, force) => {
          const result = await executeCode({
            code: code || get().code,
            lastAst: get().ast,
            engineCommandManager: engineCommandManager,
            force,
          })
          if (!result.isChange) {
            return
          }
          set({
            ast: result.ast,
            logs: result.logs,
            kclErrors: result.errors,
            programMemory: result.programMemory,
          })
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
                {
                  range: [0, code.length ? code.length - 1 : 0],
                  type: 'default',
                },
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
        setLogs: (logs) => {
          set({ logs })
        },
        kclErrors: [],
        addKCLError: (e) => {
          set((state) => ({ kclErrors: [...state.kclErrors, e] }))
        },
        resetKCLErrors: () => {
          set({ kclErrors: [] })
        },
        setErrors: (errors) => {
          set({ kclErrors: errors })
        },
        ast: {
          start: 0,
          end: 0,
          body: [],
          nonCodeMeta: {
            nonCodeNodes: {},
            start: null,
          },
        },
        setAst: (ast) => {
          set({ ast })
        },
        executeAst: async (ast) => {
          const _ast = ast || get().ast
          if (!get().isStreamReady) return

          set({ isExecuting: true })
          const { logs, errors, programMemory } = await executeAst({
            ast: _ast,
            engineCommandManager,
          })
          set({
            programMemory,
            logs,
            kclErrors: errors,
            isExecuting: false,
          })
        },
        executeAstMock: async (ast) => {
          const _ast = ast || get().ast
          if (!get().isStreamReady) return

          const { logs, errors, programMemory } = await executeAst({
            ast: _ast,
            engineCommandManager,
            useFakeExecutor: true,
          })
          set({
            programMemory,
            logs,
            kclErrors: errors,
            isExecuting: false,
          })
        },
        updateAst: async (
          ast,
          reexecute,
          { focusPath, callBack = () => {} } = {}
        ) => {
          const newCode = recast(ast)
          const astWithUpdatedSource = parse(newCode)
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
            get().executeAst(astWithUpdatedSource)
          } else {
            // When we don't re-execute, we still want to update the program
            // memory with the new ast. So we will hit the mock executor
            // instead.
            get().executeAstMock(astWithUpdatedSource)
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
        code: bracket,
        setCode: (code) => set({ code }),
        deferredSetCode: (code) => {
          set({ code })
          setDeferredCode(code)
        },
        formatCode: async () => {
          const code = get().code
          const ast = parse(code)
          const newCode = recast(ast)
          set({ code: newCode, ast })
        },
        programMemory: { root: {}, return: null },
        setProgramMemory: (programMemory) => set({ programMemory }),
        isShiftDown: false,
        setIsShiftDown: (isShiftDown) => set({ isShiftDown }),
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
        setStreamDimensions: (streamDimensions) => {
          set({ streamDimensions })
        },
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

const defaultProgramMemory: ProgramMemory['root'] = {
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
  PI: {
    type: 'UserVal',
    value: Math.PI,
    __meta: [],
  },
}

async function executeCode({
  engineCommandManager,
  code,
  lastAst,
  force,
}: {
  code: string
  lastAst: Program
  engineCommandManager: EngineCommandManager
  force?: boolean
}): Promise<
  | {
      logs: string[]
      errors: KCLError[]
      programMemory: ProgramMemory
      ast: Program
      isChange: true
    }
  | { isChange: false }
> {
  let ast: Program
  try {
    ast = parse(code)
  } catch (e) {
    let errors: KCLError[] = []
    let logs: string[] = [JSON.stringify(e)]
    if (e instanceof KCLError) {
      errors = [e]
      logs = []
      if (e.msg === 'file is empty') engineCommandManager.endSession()
    }
    return {
      isChange: true,
      logs,
      errors,
      programMemory: {
        root: {},
        return: null,
      },
      ast: {
        start: 0,
        end: 0,
        body: [],
        nonCodeMeta: {
          nonCodeNodes: {},
          start: null,
        },
      },
    }
  }
  // Check if the ast we have is equal to the ast in the storage.
  // If it is, we don't need to update the ast.
  if (JSON.stringify(ast) === JSON.stringify(lastAst) && !force)
    return { isChange: false }

  const { logs, errors, programMemory } = await executeAst({
    ast,
    engineCommandManager,
  })
  return {
    ast,
    logs,
    errors,
    programMemory,
    isChange: true,
  }
}

async function executeAst({
  ast,
  engineCommandManager,
  useFakeExecutor = false,
}: {
  ast: Program
  engineCommandManager: EngineCommandManager
  useFakeExecutor?: boolean
}): Promise<{
  logs: string[]
  errors: KCLError[]
  programMemory: ProgramMemory
}> {
  try {
    if (!useFakeExecutor) {
      engineCommandManager.endSession()
      engineCommandManager.startNewSession()
    }
    const programMemory = await (useFakeExecutor
      ? enginelessExecutor(ast, {
          root: defaultProgramMemory,
          return: null,
        })
      : _executor(
          ast,
          {
            root: defaultProgramMemory,
            return: null,
          },
          engineCommandManager
        ))

    await engineCommandManager.waitForAllCommands(ast, programMemory)
    return {
      logs: [],
      errors: [],
      programMemory,
    }
  } catch (e: any) {
    if (e instanceof KCLError) {
      return {
        errors: [e],
        logs: [],
        programMemory: {
          root: {},
          return: null,
        },
      }
    } else {
      console.log(e)
      return {
        logs: [e],
        errors: [],
        programMemory: {
          root: {},
          return: null,
        },
      }
    }
  }
}
