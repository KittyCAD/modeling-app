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
  } = useStore((s) => ({
    setEngineCommandManager: s.setEngineCommandManager,
    setMediaStream: s.setMediaStream,
    setIsStreamReady: s.setIsStreamReady,
    setStreamDimensions: s.setStreamDimensions,
  }))

  const streamWidth = streamRef?.current?.offsetWidth
  const streamHeight = streamRef?.current?.offsetHeight

  const width = streamWidth ? streamWidth : 0
  const quadWidth = Math.round(width / 4) * 4
  const height = streamHeight ? streamHeight : 0
  const quadHeight = Math.round(height / 4) * 4

  useLayoutEffect(() => {
    setStreamDimensions({
      streamWidth: quadWidth,
      streamHeight: quadHeight,
    })
    if (!width || !height) return
    const eng = new EngineCommandManager({
      setMediaStream,
      setIsStreamReady,
      width: quadWidth,
      height: quadHeight,
      token,
    })
    setEngineCommandManager(eng)
    return () => {
      eng?.tearDown()
    }
  }, [quadWidth, quadHeight])
}
