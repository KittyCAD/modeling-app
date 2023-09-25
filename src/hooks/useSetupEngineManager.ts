import { useLayoutEffect } from 'react'
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

  // Load the engine command manager once with the initial width and height,
  // then we do not want to reload it.
  const eng = new EngineCommandManager({
    setMediaStream,
    setIsStreamReady,
    token,
  })
  setEngineCommandManager(eng)
  eng.waitForReady.then(() => {
    executeCode()
  })

  useLayoutEffect(() => {
    setStreamDimensions({
      streamWidth: quadWidth,
      streamHeight: quadHeight,
    })
    return () => {}
  }, [quadWidth, quadHeight])
}
