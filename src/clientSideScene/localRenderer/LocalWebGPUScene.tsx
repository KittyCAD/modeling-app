import {
  LocalRenderer,
  type LocalRendererProps,
} from '@src/clientSideScene/localRenderer/LocalRenderer'
import { useSingletons } from '@src/lib/boot'
import { useEffect, useRef } from 'react'

export const LocalWebGPUScene = (props: LocalRendererProps) => {
  const {
    backgroundColor,
    enableSSAO,
    highlightEdges,
    onVisibilityChange,
    onExportReady,
    forceHide = false,
    commandProxyEnabled = true,
  } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<LocalRenderer | null>(null)
  const latestPropsRef = useRef(props)
  const { kclManager } = useSingletons()

  latestPropsRef.current = props

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const renderer = new LocalRenderer(
      container,
      kclManager,
      latestPropsRef.current
    )
    rendererRef.current = renderer

    return () => {
      if (rendererRef.current === renderer) {
        rendererRef.current = null
      }
      renderer.dispose()
    }
  }, [kclManager])

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

  useEffect(() => {
    rendererRef.current?.setOnExportReady(onExportReady)
  }, [onExportReady])

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-20 h-full w-full transition-opacity duration-200 opacity-0"
    />
  )
}
