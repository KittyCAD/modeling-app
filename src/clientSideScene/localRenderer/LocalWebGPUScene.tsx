import {
  LocalRenderer,
  type LocalRendererProps,
} from '@src/clientSideScene/localRenderer/LocalRenderer'
import { Spinner } from '@src/components/Spinner'
import { useSingletons } from '@src/lib/boot'
import { useCallback, useEffect, useRef, useState } from 'react'

export const LocalWebGPUScene = (props: LocalRendererProps) => {
  const {
    backgroundColor,
    enableSSAO,
    highlightEdges,
    onVisibilityChange,
    forceHide = false,
    commandProxyEnabled = true,
  } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<LocalRenderer | null>(null)
  const latestPropsRef = useRef(props)
  const { kclManager } = useSingletons()
  const isExecuting = kclManager.isExecutingSignal.value
  const [isAwaitingModel, setIsAwaitingModel] = useState(false)
  const isLoadingModel = isExecuting || isAwaitingModel

  latestPropsRef.current = props

  useEffect(() => {
    if (isExecuting) {
      setIsAwaitingModel(true)
    }
  }, [isExecuting])

  const handleModelLoadSettled = useCallback(() => {
    if (!kclManager.isExecutingSignal.value) {
      setIsAwaitingModel(false)
    }
  }, [kclManager])

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

    return () => {
      if (rendererRef.current === renderer) {
        rendererRef.current = null
      }
      renderer.dispose()
    }
  }, [handleModelLoadSettled, kclManager])

  useEffect(() => {
    rendererRef.current?.setBackgroundColor(backgroundColor)
  }, [backgroundColor])

  useEffect(() => {
    rendererRef.current?.setEnableSSAO(enableSSAO)
  }, [enableSSAO])

  useEffect(() => {
    rendererRef.current?.setHighlightEdges(highlightEdges)
  }, [highlightEdges])

  useEffect(() => {
    rendererRef.current?.setForceHide(forceHide)
  }, [forceHide])

  useEffect(() => {
    rendererRef.current?.setCommandProxyEnabled(commandProxyEnabled)
  }, [commandProxyEnabled])

  useEffect(() => {
    rendererRef.current?.setOnVisibilityChange(onVisibilityChange)
  }, [onVisibilityChange])

  return (
    <>
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 z-20 h-full w-full transition-opacity duration-200 opacity-0"
      />
      {isLoadingModel && (
        <output
          data-testid="local-renderer-loading"
          className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-chalkboard-30/80 bg-chalkboard-10/90 px-3 py-2 shadow-md backdrop-blur dark:border-chalkboard-70 dark:bg-chalkboard-90/90"
        >
          <div className="flex items-center gap-2 text-xs text-chalkboard-70 dark:text-chalkboard-30">
            <Spinner className="h-4 w-4" />
            <span>Updating model…</span>
          </div>
        </output>
      )}
    </>
  )
}
