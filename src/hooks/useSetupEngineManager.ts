import { useRef, useLayoutEffect } from 'react'
import { _executor } from '../lang/executor'
import { useStore } from '../useStore'
import { EngineCommandManager } from '../lang/std/engineConnection'

export function useSetupEngineManager(
  streamRef: React.RefObject<HTMLDivElement>,
  token?: string
) {
  const {
    setEngineCommandManager,
    setMediaStream,
    setIsStreamReady,
    setStreamDimensions,
    executeCode,
  } = useStore((s) => ({
    setEngineCommandManager: s.setEngineCommandManager,
    setMediaStream: s.setMediaStream,
    setIsStreamReady: s.setIsStreamReady,
    setStreamDimensions: s.setStreamDimensions,
    executeCode: s.executeCode,
  }))

  const streamWidth = streamRef?.current?.offsetWidth
  const streamHeight = streamRef?.current?.offsetHeight

  const width = streamWidth ? streamWidth : 0
  const quadWidth = Math.round(width / 4) * 4
  const height = streamHeight ? streamHeight : 0
  const quadHeight = Math.round(height / 4) * 4
  const eng = useRef<{
    engine: EngineCommandManager
    width: number
    height: number
  } | null>(null)

  useLayoutEffect(() => {
    setStreamDimensions({
      streamWidth: quadWidth,
      streamHeight: quadHeight,
    })
    if (!width || !height) return

    if (eng.current) {
      // Before we go further, we're going to check to see if the
      // width/height is the same as the last go-around. If it is, we
      // can continue as normal, but if it's different, we should be
      // clearing out the manager and going again.
      let c = eng.current
      if (width !== c.width || height !== c.height) {
        eng.current = null
      }
    }

    if (eng.current === null) {
      eng.current = {
        engine: new EngineCommandManager({
          setMediaStream,
          setIsStreamReady,
          width: quadWidth,
          height: quadHeight,
          token,
        }),
        width: width,
        height: height,
      }
    }
    setEngineCommandManager(eng.current.engine)
    eng.current.engine.waitForReady.then(() => {
      executeCode()
    })
    return () => {
      eng.current?.engine?.tearDown()
    }
  }, [quadWidth, quadHeight])
}
