import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  Program,
  _executor,
  ProgramMemory,
  programMemoryInit,
} from './lang/wasm'
import { enginelessExecutor } from './lib/testHelpers'
import { EngineCommandManager } from './lang/std/engineConnection'
import { KCLError } from './lang/errors'
import { SidebarType } from 'components/ModelingSidebar/ModelingPanes'

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

export interface StoreState {
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
  setHtmlRef: (ref: React.RefObject<HTMLDivElement>) => void
  htmlRef: React.RefObject<HTMLDivElement> | null

  showHomeMenu: boolean
  setHomeShowMenu: (showMenu: boolean) => void
  openPanes: SidebarType[]
  setOpenPanes: (panes: SidebarType[]) => void
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
        setHtmlRef: (htmlRef) => {
          set({ htmlRef })
        },
        htmlRef: null,
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
      : _executor(ast, programMemoryInit(), engineCommandManager, false))

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
