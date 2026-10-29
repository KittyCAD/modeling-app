import { useAppState } from '@src/AppState'
import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { getDimensions } from '@src/lib/engineConnection/utils'
import { useEffect } from 'react'

/**
 * Event handler that will watch for the page to resize and call the handleResize function to
 * resize the engine stream. There is no other workflow in the system that will resize the engine
 */
export const useOnPageResize = ({
  videoWrapperRef,
  videoRef,
  canvasRef,
  engineCommandManager,
}: {
  videoWrapperRef: React.RefObject<HTMLDivElement | null>
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  engineCommandManager: Pick<ConnectionManager, 'connection' | 'handleResize'>
}) => {
  const { isStreamAcceptingInput } = useAppState()
  useEffect(() => {
    if (!videoWrapperRef.current) return
    if (!videoRef.current) return
    if (!canvasRef.current) return
    if (!isStreamAcceptingInput) {
      console.warn('attempting to resize stream before it is ready')
      EngineDebugger.addLog({
        label: 'useOnPageResize',
        message: 'attempting to resize stream before it is ready',
      })
      return
    }

    const wrapper = videoWrapperRef.current
    let active = true
    let frame: number | null = null
    let pending = false
    let resizing = false
    const scheduleResize = () => {
      pending = true
      // One current-size update per frame also avoids ResizeObserver loops.
      if (!active || resizing || frame !== null) return
      const connection = engineCommandManager.connection
      frame = requestAnimationFrame(() => {
        frame = null
        if (!active || engineCommandManager.connection !== connection) return
        pending = false
        resizing = true
        const { width, height } = getDimensions(
          wrapper.clientWidth,
          wrapper.clientHeight
        )
        const resize = async () => {
          await connection?.deferredConnection?.promise
          if (!active || engineCommandManager.connection !== connection) return
          await engineCommandManager.handleResize({ width, height })
        }
        resize()
          .catch((e) => console.warn('handleResize', e))
          .finally(() => {
            resizing = false
            if (active && pending) scheduleResize()
          })
      })
    }
    const observer = new ResizeObserver(scheduleResize)

    observer.observe(wrapper)

    return () => {
      active = false
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [
    videoWrapperRef,
    videoRef,
    canvasRef,
    isStreamAcceptingInput,
    engineCommandManager,
  ])
}
