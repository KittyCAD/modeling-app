import { useLayoutEffect, useEffect, useRef } from 'react'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { deferExecution } from 'lib/utils'
import { Themes } from 'lib/theme'
import { makeDefaultPlanes, modifyGrid } from 'lang/wasm'
import { useModelingContext } from './useModelingContext'
import { useStore } from 'useStore'

export function useSetupEngineManager(
  streamRef: React.RefObject<HTMLDivElement>,
  token?: string,
  settings = {
    pool: null,
    theme: Themes.System,
    highlightEdges: true,
    enableSSAO: true,
    modelingSend: (() => {}) as any,
    modelingContext: {} as any,
    showScaleGrid: false,
  } as {
    pool: string | null
    theme: Themes
    highlightEdges: boolean
    enableSSAO: boolean
    modelingSend: ReturnType<typeof useModelingContext>['send']
    modelingContext: ReturnType<typeof useModelingContext>['context']
    showScaleGrid: boolean
  }
) {
  const { setIsStreamReady } = useStore((s) => ({
    setIsStreamReady: s.setIsStreamReady,
  }))

  const streamWidth = streamRef?.current?.offsetWidth
  const streamHeight = streamRef?.current?.offsetHeight

  const hasSetNonZeroDimensions = useRef<boolean>(false)

  if (settings.pool) {
    // override the pool param (?pool=) to request a specific engine instance
    // from a particular pool.
    engineCommandManager.pool = settings.pool
  }

  const startEngineInstance = () => {
    // Load the engine command manager once with the initial width and height,
    // then we do not want to reload it.
    const { width: quadWidth, height: quadHeight } = getDimensions(
      streamWidth,
      streamHeight
    )
    if (
      !hasSetNonZeroDimensions.current &&
      quadHeight &&
      quadWidth &&
      settings.modelingSend
    ) {
      engineCommandManager.start({
        setMediaStream: (mediaStream) =>
          settings.modelingSend({
            type: 'Set context',
            data: { mediaStream },
          }),
        setIsStreamReady,
        width: quadWidth,
        height: quadHeight,
        executeCode: () => {
          // We only want to execute the code here that we already have set.
          // Nothing else.
          return kclManager.executeCode(true, true)
        },
        token,
        settings,
        makeDefaultPlanes: () => {
          return makeDefaultPlanes(kclManager.engineCommandManager)
        },
        modifyGrid: (hidden: boolean) => {
          return modifyGrid(kclManager.engineCommandManager, hidden)
        },
      })
      settings.modelingSend({
        type: 'Set context',
        data: {
          streamDimensions: {
            streamWidth: quadWidth,
            streamHeight: quadHeight,
          },
        },
      })
      hasSetNonZeroDimensions.current = true
    }
  }

  useLayoutEffect(startEngineInstance, [
    streamRef?.current?.offsetWidth,
    streamRef?.current?.offsetHeight,
    settings.modelingSend,
  ])

  useEffect(() => {
    const handleResize = deferExecution(() => {
      const { width, height } = getDimensions(
        streamRef?.current?.offsetWidth,
        streamRef?.current?.offsetHeight
      )
      if (
        settings.modelingContext.store.streamDimensions.streamWidth !== width ||
        settings.modelingContext.store.streamDimensions.streamHeight !== height
      ) {
        engineCommandManager.handleResize({
          streamWidth: width,
          streamHeight: height,
        })
        settings.modelingSend({
          type: 'Set context',
          data: {
            streamDimensions: {
              streamWidth: width,
              streamHeight: height,
            },
          },
        })
      }
    }, 500)

    const onOnline = () => {
      startEngineInstance()
    }

    const onOffline = () => {
      engineCommandManager.tearDown()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
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
