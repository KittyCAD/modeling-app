import { useLayoutEffect, useEffect, useRef } from 'react'
import { useStore } from '../useStore'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { deferExecution } from 'lib/utils'
import { Themes } from 'lib/theme'
import { makeDefaultPlanes } from 'lang/wasm'

export function useSetupEngineManager(
  streamRef: React.RefObject<HTMLDivElement>,
  token?: string,
  settings = {
    pool: null,
    theme: Themes.System,
    highlightEdges: true,
    enableSSAO: true,
  } as {
    pool: string | null
    theme: Themes
    highlightEdges: boolean
    enableSSAO: boolean
  }
) {
  const {
    setMediaStream,
    setIsStreamReady,
    setStreamDimensions,
    streamDimensions,
  } = useStore((s) => ({
    setMediaStream: s.setMediaStream,
    setIsStreamReady: s.setIsStreamReady,
    setStreamDimensions: s.setStreamDimensions,
    streamDimensions: s.streamDimensions,
  }))

  const streamWidth = streamRef?.current?.offsetWidth
  const streamHeight = streamRef?.current?.offsetHeight

  const hasSetNonZeroDimensions = useRef<boolean>(false)

  if (settings.pool) {
    // override the pool param (?pool=) to request a specific engine instance
    // from a particular pool.
    engineCommandManager.pool = settings.pool
  }

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
        executeCode: () => {
          // We only want to execute the code here that we already have set.
          // Nothing else.
          return kclManager.executeCode(true)
        },
        token,
        settings,
        makeDefaultPlanes: () => {
          return makeDefaultPlanes(kclManager.engineCommandManager)
        },
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
  const maxResolution = 2000
  const width = streamWidth ? streamWidth : 0
  const height = streamHeight ? streamHeight : 0
  const ratio = Math.min(
    Math.min(maxResolution / width, maxResolution / height),
    1.0
  )
  const quadWidth = Math.round((width * ratio) / 4) * 4
  const quadHeight = Math.round((height * ratio) / 4) * 4
  return { width: quadWidth, height: quadHeight }
}
