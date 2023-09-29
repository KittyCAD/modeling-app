import { useLayoutEffect, useEffect, useRef } from 'react'
import { _executor } from '../lang/wasm'
import { useStore } from '../useStore'
import { engineCommandManager } from '../lang/std/engineConnection'
import { deferExecution } from 'lib/utils'
import { v4 as uuidv4 } from 'uuid'

export function useSetupEngineManager(
  streamRef: React.RefObject<HTMLDivElement>,
  token?: string
) {
  const {
    setMediaStream,
    setIsStreamReady,
    setStreamDimensions,
    streamDimensions,
    executeCode,
  } = useStore((s) => ({
    setMediaStream: s.setMediaStream,
    setIsStreamReady: s.setIsStreamReady,
    setStreamDimensions: s.setStreamDimensions,
    streamDimensions: s.streamDimensions,
    executeCode: s.executeCode,
  }))

  const streamWidth = streamRef?.current?.offsetWidth
  const streamHeight = streamRef?.current?.offsetHeight

  const hasSetNonZeroDimensions = useRef<boolean>(false)

  useLayoutEffect(() => {
    // Load the engine command manager once with the initial width and height,
    // then we do not want to reload it.
    const { width: quadWidth, height: quadHeight } = getDimensions(
      streamWidth,
      streamHeight
    )
    if (!hasSetNonZeroDimensions.current && quadHeight && quadWidth) {
      engineCommandManager.start({
        setMediaStream,
        setIsStreamReady,
        width: quadWidth,
        height: quadHeight,
        executeCode,
        token,
      })
      setStreamDimensions({
        streamWidth: quadWidth,
        streamHeight: quadHeight,
      })
      hasSetNonZeroDimensions.current = true
    }
  }, [streamRef?.current?.offsetWidth, streamRef?.current?.offsetHeight])

  useEffect(() => {
    const handleResize = deferExecution(() => {
      const { width, height } = getDimensions(
        streamRef?.current?.offsetWidth,
        streamRef?.current?.offsetHeight
      )
      if (
        streamDimensions.streamWidth !== width ||
        streamDimensions.streamHeight !== height
      ) {
        engineCommandManager.handleResize({
          streamWidth: width,
          streamHeight: height,
        })
        setStreamDimensions({
          streamWidth: width,
          streamHeight: height,
        })
      }
    }, 500)

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])
}

function getDimensions(streamWidth?: number, streamHeight?: number) {
  const width = streamWidth ? streamWidth : 0
  const quadWidth = Math.round(width / 4) * 4
  const height = streamHeight ? streamHeight : 0
  const quadHeight = Math.round(height / 4) * 4
  return { width: quadWidth, height: quadHeight }
}
