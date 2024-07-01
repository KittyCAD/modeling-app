import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  Program,
  _executor,
  ProgramMemory,
  programMemoryInit,
  kclLint,
} from './lang/wasm'
import { enginelessExecutor } from './lib/testHelpers'
import { EngineCommandManager } from './lang/std/engineConnection'
import { KCLError } from './lang/errors'
import { SidebarType } from 'components/ModelingSidebar/ModelingPanes'
import { Diagnostic } from '@codemirror/lint'

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
  streamDimensions: { streamWidth: number; streamHeight: number }
  setStreamDimensions: (dimensions: {
    streamWidth: number
    streamHeight: number
  }) => void
  setHtmlRef: (ref: React.RefObject<HTMLDivElement>) => void
  htmlRef: React.RefObject<HTMLDivElement> | null

  openPanes: SidebarType[]
  setOpenPanes: (panes: SidebarType[]) => void
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      return {
        setMediaStream: (mediaStream) => set({ mediaStream }),
        setIsStreamReady: (isStreamReady) => set({ isStreamReady }),
        setIsKclLspServerReady: (isKclLspServerReady) =>
          set({ isKclLspServerReady }),
        setIsCopilotLspServerReady: (isCopilotLspServerReady) =>
          set({ isCopilotLspServerReady }),
        setButtonDownInStream: (buttonDownInStream) => {
          set({ buttonDownInStream })
        },
        setHtmlRef: (htmlRef) => {
          set({ htmlRef })
        },
        setDidDragInStream: (didDragInStream) => {
          set({ didDragInStream })
        },
        // For stream event handling
        setStreamDimensions: (streamDimensions) => {
          set({ streamDimensions })
        },
        isStreamReady: false,
        isKclLspServerReady: false,
        isCopilotLspServerReady: false,
        buttonDownInStream: undefined,
        htmlRef: null,
        didDragInStream: false,
        streamDimensions: { streamWidth: 1280, streamHeight: 720 },

        // tauri specific app settings
        defaultDir: {
          dir: '',
        },
        openPanes: ['code'],
        setOpenPanes: (openPanes) => set({ openPanes }),
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

export async function lintAst({
  ast,
}: {
  ast: Program
}): Promise<Array<Diagnostic>> {
  try {
    const discovered_findings = await kclLint(ast)
    return discovered_findings.map((lint) => {
      return {
        message: lint.finding.title,
        severity: 'info',
        from: lint.pos[0],
        to: lint.pos[1],
      }
    })
  } catch (e: any) {
    console.log(e)
    return []
  }
}
