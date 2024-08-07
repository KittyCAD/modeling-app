import { useLayoutEffect, useEffect, useRef } from 'react'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { deferExecution } from 'lib/utils'
import { Themes } from 'lib/theme'
import { makeDefaultPlanes, modifyGrid } from 'lang/wasm'
import { useModelingContext } from './useModelingContext'
import { useAppState, useAppStream } from 'AppState'

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
  const { setAppState } = useAppState()
  const { setMediaStream } = useAppStream()

  const hasSetNonZeroDimensions = useRef<boolean>(false)

  if (settings.pool) {
    // override the pool param (?pool=) to request a specific engine instance
    // from a particular pool.
    engineCommandManager.pool = settings.pool
  }

  const startEngineInstance = (restart: boolean = false) => {
    // Load the engine command manager once with the initial width and height,
    // then we do not want to reload it.
    const { width: quadWidth, height: quadHeight } = getDimensions(
      streamRef?.current?.offsetWidth ?? 0,
      streamRef?.current?.offsetHeight ?? 0
    )
    engineCommandManager.start({
      setMediaStream: (mediaStream) => setMediaStream(mediaStream),
      setIsStreamReady: (isStreamReady) => setAppState({ isStreamReady }),
      width: quadWidth,
      height: quadHeight,
      executeCode: () => {
        // We only want to execute the code here that we already have set.
        // Nothing else.
        kclManager.isFirstRender = true
        return kclManager.executeCode(true).then(() => {
          kclManager.isFirstRender = false
        })
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

  useLayoutEffect(() => {
    const { width: quadWidth, height: quadHeight } = getDimensions(
      streamRef?.current?.offsetWidth ?? 0,
      streamRef?.current?.offsetHeight ?? 0
    )
    if (!hasSetNonZeroDimensions.current && quadHeight && quadWidth) {
      startEngineInstance()
    }
  }, [
    streamRef?.current?.offsetWidth,
    streamRef?.current?.offsetHeight,
    settings.modelingSend,
  ])

  useEffect(() => {
    const handleResize = deferExecution(() => {
      const { width, height } = getDimensions(
        streamRef?.current?.offsetWidth ?? 0,
        streamRef?.current?.offsetHeight ?? 0
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
      startEngineInstance(true)
    }

    const onVisibilityChange = () => {
      if (window.document.visibilityState === 'visible') {
        if (
          !engineCommandManager.engineConnection?.isReady() &&
          !engineCommandManager.engineConnection?.isConnecting()
        ) {
          startEngineInstance()
        }
      }
    }
    window.document.addEventListener('visibilitychange', onVisibilityChange)

    const onAnyInput = () => {
      if (
        !engineCommandManager.engineConnection?.isReady() &&
        !engineCommandManager.engineConnection?.isConnecting()
      ) {
        startEngineInstance()
      }
    }
    window.document.addEventListener('keydown', onAnyInput)
    window.document.addEventListener('mousemove', onAnyInput)
    window.document.addEventListener('mousedown', onAnyInput)
    window.document.addEventListener('scroll', onAnyInput)
    window.document.addEventListener('touchstart', onAnyInput)

    const onOffline = () => {
      kclManager.isFirstRender = true
      engineCommandManager.tearDown()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('resize', handleResize)
    return () => {
      window.document.removeEventListener(
        'visibilitychange',
        onVisibilityChange
      )
      window.document.removeEventListener('keydown', onAnyInput)
      window.document.removeEventListener('mousemove', onAnyInput)
      window.document.removeEventListener('mousedown', onAnyInput)
      window.document.removeEventListener('scroll', onAnyInput)
      window.document.removeEventListener('touchstart', onAnyInput)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('resize', handleResize)
    }

    // Engine relies on many settings so we should rebind events when it changes
    // We have to list out the ones we care about because the settings object holds
    // non-settings too...
  }, [
    settings.enableSSAO,
    settings.highlightEdges,
    settings.showScaleGrid,
    settings.theme,
    settings.pool,
  ])
}

function getDimensions(streamWidth?: number, streamHeight?: number) {
  const factorOf = 4
  const maxResolution = 2000
  const width = streamWidth ? streamWidth : 0
  const height = streamHeight ? streamHeight : 0
  const ratio = Math.min(
    Math.min(maxResolution / width, maxResolution / height),
    1.0
  )
  const quadWidth = Math.round((width * ratio) / factorOf) * factorOf
  const quadHeight = Math.round((height * ratio) / factorOf) * factorOf
  return { width: quadWidth, height: quadHeight }
}
