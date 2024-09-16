import { MouseEventHandler, useEffect, useRef, useState } from 'react'
import Loading from './Loading'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useModelingContext } from 'hooks/useModelingContext'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { ClientSideScene } from 'clientSideScene/ClientSideSceneComp'
import { btnName } from 'lib/cameraControls'
import { sendSelectEventToEngine } from 'lib/selections'
import { kclManager, engineCommandManager, sceneInfra } from 'lib/singletons'
import { useAppStream } from 'AppState'
import {
  EngineCommandManagerEvents,
  EngineConnectionStateType,
  DisconnectingType,
} from 'lang/std/engineConnection'
import { useRouteLoaderData } from 'react-router-dom'
import { PATHS } from 'lib/paths'
import { IndexLoaderData } from 'lib/types'

enum StreamState {
  Playing = 'playing',
  Paused = 'paused',
  Resuming = 'resuming',
  Unset = 'unset',
}

export const Stream = () => {
  const [isLoading, setIsLoading] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { settings } = useSettingsAuthContext()
  const { state, send } = useModelingContext()
  const { mediaStream } = useAppStream()
  const { overallState, immediateState } = useNetworkContext()
  const [streamState, setStreamState] = useState(StreamState.Unset)
  const { file } = useRouteLoaderData(PATHS.FILE) as IndexLoaderData

  const IDLE = settings.context.app.streamIdleMode.current

  const isNetworkOkay =
    overallState === NetworkHealthState.Ok ||
    overallState === NetworkHealthState.Weak

  /**
   * Execute code and show a "building scene message"
   * in Stream.tsx in the meantime.
   *
   * I would like for this to live somewhere more central,
   * but it seems to me that we need the video element ref
   * to be able to play the video after the code has been
   * executed. If we can find a way to do this from a more
   * central place, we can move this code there.
   */
  function executeCodeAndPlayStream() {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    kclManager.executeCode(true).then(async () => {
      await videoRef.current?.play().catch((e) => {
        console.warn('Video playing was prevented', e, videoRef.current)
      })
      setStreamState(StreamState.Playing)
    })
  }

  /**
   * Subscribe to execute code when the file changes
   * but only if the scene is already ready.
   * See onSceneReady for the initial scene setup.
   */
  useEffect(() => {
    if (engineCommandManager.engineConnection?.isReady() && file?.path) {
      console.log('execute on file change')
      executeCodeAndPlayStream()
    }
  }, [file?.path, engineCommandManager.engineConnection])

  useEffect(() => {
    if (
      immediateState.type === EngineConnectionStateType.Disconnecting &&
      immediateState.value.type === DisconnectingType.Pause
    ) {
      setStreamState(StreamState.Paused)
    }
  }, [immediateState])

  // Linux has a default behavior to paste text on middle mouse up
  // This adds a listener to block that pasting if the click target
  // is not a text input, so users can move in the 3D scene with
  // middle mouse drag with a text input focused without pasting.
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const isHtmlElement = e.target && e.target instanceof HTMLElement
      const isEditable =
        (isHtmlElement && !('explicitOriginalTarget' in e)) ||
        ('explicitOriginalTarget' in e &&
          ((e.explicitOriginalTarget as HTMLElement).contentEditable ===
            'true' ||
            ['INPUT', 'TEXTAREA'].some(
              (tagName) =>
                tagName === (e.explicitOriginalTarget as HTMLElement).tagName
            )))
      if (!isEditable) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
    }

    globalThis?.window?.document?.addEventListener('paste', handlePaste, {
      capture: true,
    })

    const IDLE_TIME_MS = 1000 * 60 * 2
    let timeoutIdIdleA: ReturnType<typeof setTimeout> | undefined = undefined

    const teardown = () => {
      // Already paused
      if (streamState === StreamState.Paused) return

      videoRef.current?.pause()
      setStreamState(StreamState.Paused)
      sceneInfra.modelingSend({ type: 'Cancel' })
      // Give video time to pause
      window.requestAnimationFrame(() => {
        engineCommandManager.tearDown({ idleMode: true })
      })
    }

    const onVisibilityChange = () => {
      if (globalThis.window.document.visibilityState === 'hidden') {
        clearTimeout(timeoutIdIdleA)
        timeoutIdIdleA = setTimeout(teardown, IDLE_TIME_MS)
      } else if (!engineCommandManager.engineConnection?.isReady()) {
        clearTimeout(timeoutIdIdleA)
        setStreamState(StreamState.Resuming)
      }
    }

    // Teardown everything if we go hidden or reconnect
    if (IDLE) {
      globalThis?.window?.document?.addEventListener(
        'visibilitychange',
        onVisibilityChange
      )
    }

    let timeoutIdIdleB: ReturnType<typeof setTimeout> | undefined = undefined

    const onAnyInput = () => {
      if (streamState === StreamState.Playing) {
        // Clear both timers
        clearTimeout(timeoutIdIdleA)
        clearTimeout(timeoutIdIdleB)
        timeoutIdIdleB = setTimeout(teardown, IDLE_TIME_MS)
      }
      if (streamState === StreamState.Paused) {
        setStreamState(StreamState.Resuming)
      }
    }

    if (IDLE) {
      globalThis?.window?.document?.addEventListener('keydown', onAnyInput)
      globalThis?.window?.document?.addEventListener('mousemove', onAnyInput)
      globalThis?.window?.document?.addEventListener('mousedown', onAnyInput)
      globalThis?.window?.document?.addEventListener('scroll', onAnyInput)
      globalThis?.window?.document?.addEventListener('touchstart', onAnyInput)
    }

    if (IDLE) {
      timeoutIdIdleB = setTimeout(teardown, IDLE_TIME_MS)
    }

    /**
     * Add a listener to execute code and play the stream
     * on initial stream setup.
     */
    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.SceneReady,
      executeCodeAndPlayStream
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.SceneReady,
        executeCodeAndPlayStream
      )
      globalThis?.window?.document?.removeEventListener('paste', handlePaste, {
        capture: true,
      })
      if (IDLE) {
        clearTimeout(timeoutIdIdleA)
        clearTimeout(timeoutIdIdleB)

        globalThis?.window?.document?.removeEventListener(
          'visibilitychange',
          onVisibilityChange
        )
        globalThis?.window?.document?.removeEventListener('keydown', onAnyInput)
        globalThis?.window?.document?.removeEventListener(
          'mousemove',
          onAnyInput
        )
        globalThis?.window?.document?.removeEventListener(
          'mousedown',
          onAnyInput
        )
        globalThis?.window?.document?.removeEventListener('scroll', onAnyInput)
        globalThis?.window?.document?.removeEventListener(
          'touchstart',
          onAnyInput
        )
      }
    }
  }, [IDLE, streamState])

  /**
   * Play the vid
   */
  useEffect(() => {
    if (!kclManager.isExecuting) {
      setTimeout(() => {
        // execute in the next event loop
        videoRef.current?.play().catch((e) => {
          console.warn('Video playing was prevented', e, videoRef.current)
        })
      })
    }
  }, [kclManager.isExecuting])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined'
    )
      return
    if (!videoRef.current) return
    if (!mediaStream) return

    // The browser complains if we try to load a new stream without pausing first.
    // Do not immediately play the stream!
    try {
      videoRef.current.srcObject = mediaStream
      videoRef.current.pause()
    } catch (e) {
      console.warn('Attempted to pause stream while play was still loading', e)
    }

    send({
      type: 'Set context',
      data: {
        videoElement: videoRef.current,
      },
    })

    setIsLoading(false)
  }, [mediaStream])

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isNetworkOkay) return
    if (!videoRef.current) return
    if (state.matches('Sketch')) return
    if (state.matches({ idle: 'showPlanes' })) return

    if (btnName(e).left) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sendSelectEventToEngine(e, videoRef.current)
    }
  }

  return (
    <div
      className="absolute inset-0 z-0"
      id="stream"
      data-testid="stream"
      onClick={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
      onContextMenuCapture={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        muted
        autoPlay
        controls={false}
        onPlay={() => setIsLoading(false)}
        className="w-full cursor-pointer h-full"
        disablePictureInPicture
        id="video-stream"
      />
      <ClientSideScene
        cameraControls={settings.context.modeling.mouseControls.current}
      />
      {(streamState === StreamState.Paused ||
        streamState === StreamState.Resuming) && (
        <div className="text-center absolute inset-0">
          <div
            className="flex flex-col items-center justify-center h-screen"
            data-testid="paused"
          >
            <div className="border-primary border p-2 rounded-sm">
              <svg
                width="8"
                height="12"
                viewBox="0 0 8 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M2 12V0H0V12H2ZM8 12V0H6V12H8Z"
                  fill="var(--primary)"
                />
              </svg>
            </div>
            <p className="text-base mt-2 text-primary bold">
              {streamState === StreamState.Paused && 'Paused'}
              {streamState === StreamState.Resuming && 'Resuming'}
            </p>
          </div>
        </div>
      )}
      {(!isNetworkOkay || isLoading) && (
        <div className="text-center absolute inset-0">
          <Loading>
            {!isNetworkOkay && !isLoading ? (
              <span data-testid="loading-stream">Stream disconnected...</span>
            ) : (
              !isLoading && (
                <span data-testid="loading-stream">Loading stream...</span>
              )
            )}
          </Loading>
        </div>
      )}
    </div>
  )
}
