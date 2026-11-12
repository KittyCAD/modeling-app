import {
  LocalRenderer,
  type LocalRendererProps,
} from '@src/clientSideScene/localRenderer/LocalRenderer'
import { Spinner } from '@src/components/Spinner'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { createThumbnailPNGOnDesktop } from '@src/lib/screenshot'
import { useCallback, useEffect, useRef, useState } from 'react'

// The default planes are shown or hidden about 200 ms after an execution, so
// the thumbnail waits for them, like the streamed one does.
const THUMBNAIL_DELAY_MS = 500
// Read completed work without rerendering for every command response.
const COMMAND_PROGRESS_POLL_MS = 100

export const LocalWebGPUScene = (props: LocalRendererProps) => {
  const {
    theme,
    enableSSAO,
    shouldHighlightEdges,
    fixedSizeGrid,
    backfaceColor,
  } = props
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
  const [progress, setProgress] = useState(0)
  const estimatedCommandCount = kclManager.estimatedCommandCount.value
  const isLoadingModel = isExecuting || isAwaitingModel

  latestPropsRef.current = props

  useEffect(() => {
    if (isExecuting) {
      setIsAwaitingModel(true)
      setProgress(0)
      const intervalId = window.setInterval(() => {
        const total = kclManager.estimatedCommandCount.peek()
        if (total && total > 0) {
          const fraction =
            kclManager.engineCommandManager.executionProgress.fraction
          setProgress((previous) => Math.max(previous, fraction))
        }
      }, COMMAND_PROGRESS_POLL_MS)
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
    rendererRef.current?.setEdgeHighlighting(shouldHighlightEdges)
  }, [shouldHighlightEdges])

  useEffect(() => {
    rendererRef.current?.setFixedSizeGrid(fixedSizeGrid)
  }, [fixedSizeGrid])

  useEffect(() => {
    rendererRef.current?.setBackfaceColor(backfaceColor)
  }, [backfaceColor])

  return (
    <>
      <div
        ref={containerRef}
        data-testid="local-renderer-viewport"
        className="pointer-events-none absolute inset-0 h-full w-full transition-[opacity,filter] duration-200 motion-reduce:transition-none opacity-0"
        style={{
          filter: isLoadingModel ? 'grayscale(1) opacity(0.55)' : undefined,
        }}
      />
      {isLoadingModel && (
        <output
          data-testid="local-renderer-loading"
          className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-chalkboard-30/80 bg-chalkboard-10/90 px-4 py-2.5 shadow-md backdrop-blur dark:border-chalkboard-70 dark:bg-chalkboard-90/90"
        >
          <div className="flex items-center gap-2.5 text-[15px] leading-[21px] text-chalkboard-70 dark:text-chalkboard-30">
            {!estimatedCommandCount || !isExecuting ? (
              <Spinner className="h-[21px] w-[21px]" />
            ) : (
              <div
                role="progressbar"
                aria-label="Model execution"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                className="h-2 w-32 overflow-hidden rounded-full bg-chalkboard-30 dark:bg-chalkboard-70"
              >
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            )}
            <span>{isExecuting ? 'Executing' : 'Updating model…'}</span>
          </div>
        </output>
      )}
    </>
  )
}
