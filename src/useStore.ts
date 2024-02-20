import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addLineHighlight, EditorView } from './editor/highlightextension'
import {
  parse,
  Program,
  _executor,
  ProgramMemory,
  programMemoryInit,
} from './lang/wasm'
import { Selection } from 'lib/selections'
import { enginelessExecutor } from './lib/testHelpers'
import { EngineCommandManager } from './lang/std/engineConnection'
import { KCLError } from './lang/errors'

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
  | 'tangentialArcTo'

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
  'tangentialArcTo',
] as any as ToolTip[]

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
  isShiftDown: boolean
  setIsShiftDown: (isShiftDown: boolean) => void
  mediaStream?: MediaStream
  setMediaStream: (mediaStream: MediaStream) => void
  isStreamReady: boolean
  setIsStreamReady: (isStreamReady: boolean) => void
  isKclLspServerReady: boolean
  isCopilotLspServerReady: boolean
  setIsKclLspServerReady: (isKclLspServerReady: boolean) => void
  setIsCopilotLspServerReady: (isCopilotLspServerReady: boolean) => void
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
          const safeEnd = Math.min(
            selection[1],
            editorView?.state.doc.length || selection[1]
          )
          if (editorView) {
            editorView.dispatch({
              effects: addLineHighlight.of([selection[0], safeEnd]),
            })
          }
        },
        isShiftDown: false,
        setIsShiftDown: (isShiftDown) => set({ isShiftDown }),
        setMediaStream: (mediaStream) => set({ mediaStream }),
        isStreamReady: false,
        setIsStreamReady: (isStreamReady) => set({ isStreamReady }),
        isKclLspServerReady: false,
        isCopilotLspServerReady: false,
        setIsKclLspServerReady: (isKclLspServerReady) =>
          set({ isKclLspServerReady }),
        setIsCopilotLspServerReady: (isCopilotLspServerReady) =>
          set({ isCopilotLspServerReady }),
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

export async function executeCode({
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
          start: [],
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
  programMemoryOverride,
}: {
  ast: Program
  engineCommandManager: EngineCommandManager
  useFakeExecutor?: boolean
  programMemoryOverride?: ProgramMemory
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
      ? enginelessExecutor(ast, programMemoryOverride || programMemoryInit())
      : _executor(ast, programMemoryInit(), engineCommandManager))

    await engineCommandManager.waitForAllCommands()
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
