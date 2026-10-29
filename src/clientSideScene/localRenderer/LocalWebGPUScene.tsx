import {
  LocalRenderer,
  type LocalRendererProps,
} from '@src/clientSideScene/localRenderer/LocalRenderer'
import { Spinner } from '@src/components/Spinner'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { KclManager } from '@src/lang/KclManager'
import { useApp, useSingletons } from '@src/lib/boot'
import { createThumbnailPNGOnDesktop } from '@src/lib/screenshot'
import { useCallback, useEffect, useRef, useState } from 'react'

// The default planes are shown or hidden about 200 ms after an execution, so
// the thumbnail waits for them, like the streamed one does.
const THUMBNAIL_DELAY_MS = 500
// How often the pending command count is read, as the status bar's tooltip does.
const PENDING_COMMAND_POLL_MS = 100

/** Engine commands sent and not yet answered, as the status bar counts them. */
function getPendingCommandCount(kclManager: KclManager) {
  return Object.keys(kclManager.engineCommandManager.pendingCommands).length
}

export const LocalWebGPUScene = (props: LocalRendererProps) => {
  const { theme, enableSSAO, highlightEdges, fixedSizeGrid } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<LocalRenderer | null>(null)
  const latestPropsRef = useRef(props)
  const app = useApp()
  const { kclManager } = useSingletons()
  const { state } = useModelingContext()
  const pickingEnabled =
    state.matches('idle') || state.matches('Sketch no face')
  const defaultPlaneVisibility = state.context.defaultPlaneVisibility
  const isExecuting = kclManager.isExecutingSignal.value
  const [isAwaitingModel, setIsAwaitingModel] = useState(false)
  const [pendingCommandCount, setPendingCommandCount] = useState(0)
  const isLoadingModel = isExecuting || isAwaitingModel

  latestPropsRef.current = props

  useEffect(() => {
    if (isExecuting) {
      setIsAwaitingModel(true)
      setPendingCommandCount(getPendingCommandCount(kclManager))
      const intervalId = window.setInterval(
        () => setPendingCommandCount(getPendingCommandCount(kclManager)),
        PENDING_COMMAND_POLL_MS
      )
      return () => window.clearInterval(intervalId)
    }
  }, [isExecuting, kclManager])

  const handleModelLoadSettled = useCallback(
    (isNewModel?: boolean) => {
      if (!kclManager.isExecutingSignal.value) {
        setIsAwaitingModel(false)
      }
      const renderer = rendererRef.current
      const projectPath = app.project?.projectIORefSignal.value.path
      if (isNewModel && renderer && projectPath) {
        setTimeout(() => {
          renderer.readFrame((renderedCanvas) =>
            createThumbnailPNGOnDesktop({
              fileOperations: app.fileOperations,
              projectDirectoryWithoutEndingSlash: projectPath,
              renderedCanvas,
            })
          )
        }, THUMBNAIL_DELAY_MS)
      }
    },
    [kclManager, app]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const renderer = new LocalRenderer(container, kclManager, {
      ...latestPropsRef.current,
      onModelLoadSettled: handleModelLoadSettled,
    })
    rendererRef.current = renderer
    kclManager.sceneInfra.localRenderer = renderer

    return () => {
      if (rendererRef.current === renderer) {
        rendererRef.current = null
      }
      if (kclManager.sceneInfra.localRenderer === renderer) {
        kclManager.sceneInfra.localRenderer = null
      }
      renderer.dispose()
    }
  }, [handleModelLoadSettled, kclManager])

  useEffect(() => {
    rendererRef.current?.setTheme(theme)
  }, [theme])

  useEffect(() => {
    rendererRef.current?.setPickingEnabled(pickingEnabled)
  }, [pickingEnabled, kclManager])

  useEffect(() => {
    rendererRef.current?.setDefaultPlaneVisibility(defaultPlaneVisibility)
  }, [defaultPlaneVisibility, kclManager])

  useEffect(() => {
    rendererRef.current?.setEnableSSAO(enableSSAO)
  }, [enableSSAO])

  useEffect(() => {
    rendererRef.current?.setHighlightEdges(highlightEdges)
  }, [highlightEdges])

  useEffect(() => {
    rendererRef.current?.setFixedSizeGrid(fixedSizeGrid)
  }, [fixedSizeGrid])

  return (
    <>
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-200 opacity-0"
      />
      {isLoadingModel && (
        <output
          data-testid="local-renderer-loading"
          className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-chalkboard-30/80 bg-chalkboard-10/90 px-4 py-2.5 shadow-md backdrop-blur dark:border-chalkboard-70 dark:bg-chalkboard-90/90"
        >
          <div className="flex items-center gap-2.5 text-[15px] leading-[21px] text-chalkboard-70 dark:text-chalkboard-30">
            <Spinner className="h-[21px] w-[21px]" />
            <span>
              {isExecuting
                ? `Executing (${pendingCommandCount})`
                : 'Updating model…'}
            </span>
          </div>
        </output>
      )}
    </>
  )
}
