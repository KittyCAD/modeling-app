import { useAppState, useAppStream } from 'AppState'
import { useNetworkContext } from 'hooks/useNetworkContext'
import {
  DisconnectingType,
  EngineConnectionStateType,
} from 'lang/std/engineConnection'
import { SettingsViaQueryString } from 'lib/settings/settingsTypes'
import { engineCommandManager } from 'lib/singletons'
import { Themes } from 'lib/theme'
import { deferExecution } from 'lib/utils'
import { useEffect, useLayoutEffect, useRef } from 'react'

import { useModelingContext } from './useModelingContext'

export function useSetupEngineManager(
  streamRef: React.RefObject<HTMLDivElement>,
  modelingSend: ReturnType<typeof useModelingContext>['send'],
  modelingContext: ReturnType<typeof useModelingContext>['context'],
  settings: SettingsViaQueryString = {
    pool: null,
    theme: Themes.System,
    highlightEdges: true,
    enableSSAO: true,
    showScaleGrid: false,
    cameraProjection: 'perspective',
    cameraOrbit: 'spherical',
  },
  token?: string
) {
  const networkContext = useNetworkContext()
  const { pingPongHealth, immediateState } = networkContext
  const { setAppState } = useAppState()
  const { setMediaStream } = useAppStream()

  const hasSetNonZeroDimensions = useRef<boolean>(false)

  if (settings.pool) {
    // override the pool param (?pool=) to request a specific engine instance
    // from a particular pool.
    engineCommandManager.settings.pool = settings.pool
  }

  const startEngineInstance = () => {
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
      token,
      settings,
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
    modelingSend,
  ])

  useEffect(() => {
    if (pingPongHealth === 'TIMEOUT') {
      engineCommandManager.tearDown()
    }
  }, [pingPongHealth])

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (immediateState.type === EngineConnectionStateType.Disconnected) {
        engineCommandManager.engineConnection = undefined
        startEngineInstance()
      }
    }, 3000)
    return () => {
      clearInterval(intervalId)
    }
  }, [immediateState])

  useEffect(() => {
    engineCommandManager.settings = settings

    const handleResize = deferExecution(() => {
      engineCommandManager.handleResize(
        getDimensions(
          streamRef?.current?.offsetWidth ?? 0,
          streamRef?.current?.offsetHeight ?? 0
        )
      )
    }, 500)

    const onOnline = () => {
      startEngineInstance()
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
      const isEngineNotReadyOrConnecting =
        !engineCommandManager.engineConnection?.isReady() &&
        !engineCommandManager.engineConnection?.isConnecting()

      const conn = engineCommandManager.engineConnection

      const isStreamPaused =
        conn?.state.type === EngineConnectionStateType.Disconnecting &&
        conn?.state.value.type === DisconnectingType.Pause

      if (isEngineNotReadyOrConnecting || isStreamPaused) {
        engineCommandManager.engineConnection = undefined
        startEngineInstance()
      }
    }
    window.document.addEventListener('keydown', onAnyInput)
    window.document.addEventListener('mousemove', onAnyInput)
    window.document.addEventListener('mousedown', onAnyInput)
    window.document.addEventListener('scroll', onAnyInput)
    window.document.addEventListener('touchstart', onAnyInput)

    const onOffline = () => {
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
  }, [...Object.values(settings)])
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
