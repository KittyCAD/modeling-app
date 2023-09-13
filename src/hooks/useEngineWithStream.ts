import { useLayoutEffect } from 'react'
import { useStore } from 'useStore'
import { useGlobalStateContext } from './useGlobalStateContext'
import { EngineCommandManager } from 'lang/std/engineConnection'

export function useEngineWithStream(streamRef: React.RefObject<HTMLElement>) {
  const {
    setStreamDimensions,
    setEngineCommandManager,
    setMediaStream,
    setIsStreamReady,
  } = useStore((s) => ({
    setStreamDimensions: s.setStreamDimensions,
    setEngineCommandManager: s.setEngineCommandManager,
    setMediaStream: s.setMediaStream,
    setIsStreamReady: s.setIsStreamReady,
  }))
  const {
    auth: {
      context: { token },
    },
  } = useGlobalStateContext()

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
  }, [
    quadWidth,
    quadHeight,
    setStreamDimensions,
    width,
    height,
    setMediaStream,
    setIsStreamReady,
    token,
    setEngineCommandManager,
  ])
}
