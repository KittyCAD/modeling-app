import { engineCommandManager } from '@src/lib/singletons'
import { REASONABLE_TIME_TO_REFRESH_STREAM_SIZE } from '@src/lib/timings'
import { getDimensions } from '@src/network/utils'
import { useEffect, useRef } from 'react'

export const useOnPageResize = ({
  videoWrapperRef,
  videoRef,
  canvasRef,
}: {
  videoWrapperRef: React.RefObject<HTMLDivElement>
  videoRef: React.RefObject<HTMLVideoElement>
  canvasRef: React.RefObject<HTMLCanvasElement>
}) => {
  const last = useRef<number>(Date.now())
  // When streamIdleMode is changed, setup or teardown the timeouts
  const timeoutStart = useRef<number | null>(null)
  useEffect(() => {
    // But if the user resizes, and we're stopped or paused, then we want
    // to try to restart the stream!
    if (!videoWrapperRef.current) return
    if (!videoRef.current) return
    if (!canvasRef.current) return

    const video = videoRef.current
    const wrapper = videoWrapperRef.current

    const observer = new ResizeObserver(() => {
      // Prevents:
      // `Uncaught ResizeObserver loop completed with undelivered notifications`
      window.requestAnimationFrame(() => {
        if (Date.now() - last.current < REASONABLE_TIME_TO_REFRESH_STREAM_SIZE)
          return
        last.current = Date.now()

        if (
          Math.abs(video.width - wrapper.clientWidth) > 4 ||
          Math.abs(video.height - wrapper.clientHeight) > 4
        ) {
          timeoutStart.current = Date.now()
          const { width, height } = getDimensions(
            wrapper.clientWidth,
            wrapper.clientHeight
          )
          engineCommandManager.handleResize({ width, height })
        }
      })
    })

    observer.observe(wrapper)

    return () => {
      observer.disconnect()
    }
  }, [])
}
