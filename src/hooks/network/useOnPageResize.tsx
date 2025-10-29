import { useAppState } from '@src/AppState'
import { EngineDebugger } from '@src/lib/debugger'
import { engineCommandManager } from '@src/lib/singletons'
import { REASONABLE_TIME_TO_REFRESH_STREAM_SIZE } from '@src/lib/timings'
import { getDimensions } from '@src/network/utils'
import { useEffect, useRef } from 'react'

/**
 * Event handler that will watch for the page to resize and call the handleResize function to
 * resize the engine stream. There is no other workflow in the system that will resize the engine
 */
export const useOnPageResize = ({
  videoWrapperRef,
  videoRef,
  canvasRef,
}: {
  videoWrapperRef: React.RefObject<HTMLDivElement>
  videoRef: React.RefObject<HTMLVideoElement>
  canvasRef: React.RefObject<HTMLCanvasElement>
}) => {
  const setSizeOnMoreTime = useRef<NodeJS.Timeout | null>(null)
  const last = useRef<number>(Date.now())
  // When streamIdleMode is changed, setup or teardown the timeouts
  const timeoutStart = useRef<number | null>(null)
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

    const video = videoRef.current
    const wrapper = videoWrapperRef.current

    const observer = new ResizeObserver(() => {
      window.getSize = () => {
        const { width, height } = getDimensions(
          wrapper.clientWidth,
          wrapper.clientHeight
        )
        console.log(width, height)
      }

      window.resize = () => {
        const { width, height } = getDimensions(
          wrapper.clientWidth,
          wrapper.clientHeight
        )
        engineCommandManager.handleResize({ width, height }).then(() => {
          console.log('forced', width, height)
        }).catch((e) => {
          console.warn('handleResize', e)
        })
      }

      // Prevents:
      // `Uncaught ResizeObserver loop completed with undelivered notifications`
      window.requestAnimationFrame(() => {
        if (Date.now() - last.current < REASONABLE_TIME_TO_REFRESH_STREAM_SIZE) {
          console.log('rejecting time:', video.videoWidth, wrapper.clientWidth, ' - ', video.videoHeight, wrapper.clientHeight)
          if (setSizeOnMoreTime.current) {
            clearTimeout(setSizeOnMoreTime.current)
            setSizeOnMoreTime.current = null
          }
          const resizeTimeoutId = setTimeout(() => {
            const { width, height } = getDimensions(
              wrapper.clientWidth,
              wrapper.clientHeight
            )
            engineCommandManager.handleResize({ width, height }).then(() => {
              console.log('clean up ', width, height)
            }).catch((e) => {
              console.warn('handleResize', e)
            })
          }, 250)
          setSizeOnMoreTime.current = resizeTimeoutId
          return
        }
        last.current = Date.now()
        timeoutStart.current = Date.now()
        const { width, height } = getDimensions(
          wrapper.clientWidth,
          wrapper.clientHeight
        )
        engineCommandManager.handleResize({ width, height }).then(() => {
          console.log('I am most likely ', width, height)
          clearTimeout(answer)
        }).catch((e) => {
          console.warn('handleResize', e)
        })
      })
    })

    observer.observe(wrapper)

    return () => {
      observer.disconnect()
    }
  }, [videoWrapperRef, videoRef, canvasRef, isStreamAcceptingInput])
}
