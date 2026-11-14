import {
  LocalRenderer,
  type LocalRendererProps,
} from '@src/clientSideScene/localRenderer/LocalRenderer'
import { Spinner } from '@src/components/Spinner'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'
import { legacyLocalRendererHost } from '@src/clientSideScene/localRenderer/legacyHost'
import type { PlaneVisibilityMap } from '@src/machines/modelingSharedTypes'
import { useSingletons } from '@src/lib/boot'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// The default planes are shown or hidden about 200 ms after an execution, so
// the thumbnail waits for them, like the streamed one does.
const THUMBNAIL_DELAY_MS = 500
// How often the pending command count is read, as the status bar's tooltip does.
const PENDING_COMMAND_POLL_MS = 100

/** Engine commands sent and not yet answered, as the status bar counts them. */
function getPendingCommandCount(host: LocalRendererHost) {
  return Object.keys(host.commands.pendingCommands).length
}

export const LocalWebGPUScene = (props: LocalRendererProps) => {
  const { kclManager } = useSingletons()
  const host = useMemo(() => legacyLocalRendererHost(kclManager), [kclManager])
  const { state } = useModelingContext()
  return (
    <LocalWebGPUSceneView
      {...props}
      host={host}
      pickingEnabled={state.matches('idle') || state.matches('Sketch no face')}
      defaultPlaneVisibility={state.context.defaultPlaneVisibility}
    />
  )
}

/** Render a captured scene host without consulting app singletons or modeling React context. */
export const LocalWebGPUSceneView = ({
  host,
  pickingEnabled,
  defaultPlaneVisibility,
  ...props
}: LocalRendererProps & {
  host: LocalRendererHost
  pickingEnabled: boolean
  defaultPlaneVisibility: PlaneVisibilityMap
}) => {
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
  const isExecuting = host.executing.value
  const [isAwaitingModel, setIsAwaitingModel] = useState(false)
  const [pendingCommandCount, setPendingCommandCount] = useState(0)
  const isLoadingModel = isExecuting || isAwaitingModel

  latestPropsRef.current = props

  useEffect(() => {
    if (isExecuting) {
      setIsAwaitingModel(true)
      setPendingCommandCount(getPendingCommandCount(host))
      const intervalId = window.setInterval(
        () => setPendingCommandCount(getPendingCommandCount(host)),
        PENDING_COMMAND_POLL_MS
      )
      return () => window.clearInterval(intervalId)
    }
  }, [isExecuting, host])

  const handleModelLoadSettled = useCallback(
    (isNewModel?: boolean) => {
      if (!host.executing.value) {
        setIsAwaitingModel(false)
      }
      const renderer = rendererRef.current
      const captureThumbnail = host.captureThumbnail
      if (isNewModel && renderer && captureThumbnail) {
        setTimeout(() => {
          if (rendererRef.current !== renderer) return
          renderer.readFrame(captureThumbnail)
        }, THUMBNAIL_DELAY_MS)
      }
    },
    [host]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const renderer = new LocalRenderer(container, host, {
      ...latestPropsRef.current,
      onModelLoadSettled: handleModelLoadSettled,
    })
    rendererRef.current = renderer
    host.sceneInfra.localRenderer = renderer

    return () => {
      if (rendererRef.current === renderer) {
        rendererRef.current = null
      }
      if (host.sceneInfra.localRenderer === renderer) {
        host.sceneInfra.localRenderer = null
      }
      renderer.dispose()
    }
  }, [handleModelLoadSettled, host])

  useEffect(() => {
    rendererRef.current?.setTheme(theme)
  }, [theme])

  useEffect(() => {
    rendererRef.current?.setPickingEnabled(pickingEnabled)
  }, [pickingEnabled, host])

  useEffect(() => {
    rendererRef.current?.setDefaultPlaneVisibility(defaultPlaneVisibility)
  }, [defaultPlaneVisibility, host])

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
