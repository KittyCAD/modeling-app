import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addLineHighlight, EditorView } from './editor/highlightextension'
import {
  parse,
  Program,
  _executor,
  ProgramMemory,
  Position,
  PathToNode,
  Rotation,
  SourceRange,
} from './lang/wasm'
import { enginelessExecutor } from './lib/testHelpers'
import { EditorSelection } from '@codemirror/state'
import { EngineCommandManager } from './lang/std/engineConnection'
import { KCLError } from './lang/errors'
import { kclManager } from 'lang/KclSinglton'

export type Axis = 'y-axis' | 'x-axis' | 'z-axis'

export type Selection = {
  type:
    | 'default'
    | 'line-end'
    | 'line-mid'
    | 'face'
    | 'point'
    | 'edge'
    | 'line'
    | 'arc'
    | 'all'
  range: SourceRange
}
export type Selections = {
  otherSelections: Axis[]
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

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
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
          const code = kclManager.code
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
          Object.entries(state).filter(([key]) => ['openPanes'].includes(key))
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

export async function executeAst({
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
