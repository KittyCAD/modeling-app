import { useLayoutEffect } from 'react'
import { _executor } from '../lang/executor'
import { useStore } from '../useStore'
import { engineCommandManager } from '../lang/std/engineConnection'
import { debounce } from 'debounce'

export function useSetupEngineManager(
  streamRef: React.RefObject<HTMLDivElement>,
  token?: string
) {
  const {
    setMediaStream,
    setIsStreamReady,
    setStreamDimensions,
    executeCode,
    streamDimensions,
  } = useStore((s) => ({
    setMediaStream: s.setMediaStream,
    setIsStreamReady: s.setIsStreamReady,
    setStreamDimensions: s.setStreamDimensions,
    executeCode: s.executeCode,
    streamDimensions: s.streamDimensions,
  }))

  const streamWidth = streamRef?.current?.offsetWidth
  const streamHeight = streamRef?.current?.offsetHeight

  const width = streamWidth ? streamWidth : 0
  const quadWidth = Math.round(width / 4) * 4
  const height = streamHeight ? streamHeight : 0
  const quadHeight = Math.round(height / 4) * 4

  useLayoutEffect(() => {
    // Load the engine command manager once with the initial width and height,
    // then we do not want to reload it.
    if (
      streamDimensions.streamWidth !== quadWidth ||
      streamDimensions.streamHeight !== quadHeight
    ) {
      debounce(
        () => {
          engineCommandManager.start({
            setMediaStream,
            setIsStreamReady,
            width: quadWidth,
            height: quadHeight,
            token,
          })
          engineCommandManager.waitForReady.then(() => {
            executeCode()
          })
          setStreamDimensions({
            streamWidth: quadWidth,
            streamHeight: quadHeight,
          })
        },
        500,
        true
      )()
    }
    return () => {}
  }, [quadWidth, quadHeight])
}
