import { useLayoutEffect } from 'react'
import { _executor } from '../lang/executor'
import { useStore } from '../useStore'
import { EngineCommandManager } from '../lang/std/engineConnection'

class EngineCommandManagerSingleton {
  width: number
  height: number
  engineCommandManager?: EngineCommandManager

  constructor() {
    this.width = 0
    this.height = 0
  }

  get({
    setMediaStream,
    setIsStreamReady,
    width,
    height,
    token,
  }: {
    setMediaStream: (stream: MediaStream) => void
    setIsStreamReady: (isStreamReady: boolean) => void
    width: number
    height: number
    token?: string
  }): EngineCommandManager {
    if (
      this.engineCommandManager !== undefined &&
      this.width == width &&
      this.height == height
    ) {
      return this.engineCommandManager
    }

    const ecm = new EngineCommandManager({
      setMediaStream,
      setIsStreamReady,
      width: width,
      height: height,
      token,
    })

    this.engineCommandManager = ecm
    this.width = width
    this.height = height

    return ecm
  }
}

const engineManagerSingleton = new EngineCommandManagerSingleton()

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

  useLayoutEffect(() => {
    setStreamDimensions({
      streamWidth: quadWidth,
      streamHeight: quadHeight,
    })
    if (!width || !height) return
    const eng = engineManagerSingleton.get({
      setMediaStream,
      setIsStreamReady,
      width: quadWidth,
      height: quadHeight,
      token,
    })
    setEngineCommandManager(eng)
    eng.waitForReady.then(() => {
      executeCode()
    })
    return () => {
      eng?.tearDown()
    }
  }, [quadWidth, quadHeight])
}
