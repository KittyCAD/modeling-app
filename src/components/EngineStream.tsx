import { MouseEventHandler, useEffect, useRef } from 'react'
import { useAppState } from 'AppState'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useModelingContext } from 'hooks/useModelingContext'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { ClientSideScene } from 'clientSideScene/ClientSideSceneComp'
import { btnName } from 'lib/cameraControls'
import { trap } from 'lib/trap'
import { sendSelectEventToEngine } from 'lib/selections'
import { kclManager, engineCommandManager } from 'lib/singletons'
import { EngineCommandManagerEvents } from 'lang/std/engineConnection'
import { useRouteLoaderData } from 'react-router-dom'
import { PATHS } from 'lib/paths'
import { IndexLoaderData } from 'lib/types'
import useEngineStreamContext, {
  EngineStreamState,
  EngineStreamTransition,
} from 'hooks/useEngineStreamContext'

export const EngineStream = () => {
  const { setAppState } = useAppState()

  const { overallState } = useNetworkContext()
  const { settings } = useSettingsAuthContext()
  const { file } = useRouteLoaderData(PATHS.FILE) as IndexLoaderData

  const settingsEngine = {
    theme: settings.context.app.theme.current,
    enableSSAO: settings.context.app.enableSSAO.current,
    highlightEdges: settings.context.modeling.highlightEdges.current,
    showScaleGrid: settings.context.modeling.showScaleGrid.current,
  }

  const {
    state: modelingMachineState,
    send: modelingMachineActorSend,
    context: modelingMachineActorContext,
  } = useModelingContext()

  const engineStreamActor = useEngineStreamContext.useActorRef()
  const engineStreamState = engineStreamActor.getSnapshot()

  const streamIdleMode = settings.context.app.streamIdleMode.current

  // 0.25s is the average visual reaction time for humans so we'll go a bit more
  // so those exception people don't see.
  const REASONABLE_TIME_TO_REFRESH_STREAM_SIZE = 100

  const configure = () => {
    engineStreamActor.send({
      type: EngineStreamTransition.StartOrReconfigureEngine,
      modelingMachineActorSend,
      settings: settingsEngine,
      setAppState,

      // It's possible a reconnect happens as we drag the window :')
      onMediaStream(mediaStream: MediaStream) {
        engineStreamActor.send({
          type: EngineStreamTransition.SetMediaStream,
          mediaStream,
        })
      },
    })
  }

  useEffect(() => {
    const play = () => {
      engineStreamActor.send({
        type: EngineStreamTransition.Play,
      })
    }
    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.SceneReady,
      play
    )

    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.SceneReady,
        play
      )
    }
  }, [])

  useEffect(() => {
    if (!streamIdleMode) return

    const s = setInterval(() => {
      const video = engineStreamState.context.videoRef?.current
      if (!video) return
      const canvas = engineStreamState.context.canvasRef?.current
      if (!canvas) return

      if (
        Math.abs(video.width - window.innerWidth) > 4 ||
        Math.abs(video.height - window.innerHeight) > 4
      ) {
        timeoutStart.current = Date.now()
        configure()
      }
    }, REASONABLE_TIME_TO_REFRESH_STREAM_SIZE)

    return () => {
      clearInterval(s)
    }
  }, [streamIdleMode, engineStreamState.value])

  // When the video and canvas element references are set, start the engine.
  useEffect(() => {
    if (
      engineStreamState.context.canvasRef.current &&
      engineStreamState.context.videoRef.current
    ) {
      engineStreamActor.send({
        type: EngineStreamTransition.StartOrReconfigureEngine,
        modelingMachineActorSend,
        settings: settingsEngine,
        setAppState,
        onMediaStream(mediaStream: MediaStream) {
          engineStreamActor.send({
            type: EngineStreamTransition.SetMediaStream,
            mediaStream,
          })
        },
      })
    }
  }, [
    engineStreamState.context.canvasRef.current,
    engineStreamState.context.videoRef.current,
  ])

  // On settings change, reconfigure the engine. When paused this gets really tricky,
  // and also requires onMediaStream to be set!
  useEffect(() => {
    engineStreamActor.send({
      type: EngineStreamTransition.StartOrReconfigureEngine,
      modelingMachineActorSend,
      settings: settingsEngine,
      setAppState,
      onMediaStream(mediaStream: MediaStream) {
        engineStreamActor.send({
          type: EngineStreamTransition.SetMediaStream,
          mediaStream,
        })
      },
    })
  }, [settings.context])

  /**
   * Subscribe to execute code when the file changes
   * but only if the scene is already ready.
   * See onSceneReady for the initial scene setup.
   */
  useEffect(() => {
    if (engineCommandManager.engineConnection?.isReady() && file?.path) {
      console.log('execute on file change')
      void kclManager.executeCode(true).catch(trap)
    }
  }, [file?.path, engineCommandManager.engineConnection])

  const IDLE_TIME_MS = Number(streamIdleMode)

  // When streamIdleMode is changed, setup or teardown the timeouts
  const timeoutStart = useRef<number | null>(null)

  useEffect(() => {
    timeoutStart.current = streamIdleMode ? Date.now() : null
  }, [streamIdleMode])

  useEffect(() => {
    let frameId = undefined
    const frameLoop = () => {
      // Do not pause if the user is in the middle of an operation
      if (!modelingMachineState.matches('idle')) {
        // In fact, stop the timeout, because we don't want to trigger the
        // pause when we exit the operation.
        timeoutStart.current = null
      } else if (timeoutStart.current) {
        const elapsed = Date.now() - timeoutStart.current
        if (elapsed >= IDLE_TIME_MS) {
          timeoutStart.current = null
          engineStreamActor.send({ type: EngineStreamTransition.Pause })
        }
      }
      frameId = window.requestAnimationFrame(frameLoop)
    }
    frameId = window.requestAnimationFrame(frameLoop)

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [modelingMachineState])

  useEffect(() => {
    if (!streamIdleMode) return

    const onAnyInput = () => {
      // Just in case it happens in the middle of the user turning off
      // idle mode.
      if (!streamIdleMode) {
        timeoutStart.current = null
        return
      }

      if (engineStreamState.value === EngineStreamState.Paused) {
        engineStreamActor.send({
          type: EngineStreamTransition.StartOrReconfigureEngine,
          modelingMachineActorSend,
          settings: settingsEngine,
          setAppState,
          onMediaStream(mediaStream: MediaStream) {
            engineStreamActor.send({
              type: EngineStreamTransition.SetMediaStream,
              mediaStream,
            })
          },
        })
      }

      timeoutStart.current = Date.now()
    }

    // It's possible after a reconnect, the user doesn't move their mouse at
    // all, meaning the timer is not reset to run. We need to set it every
    // time our effect dependencies change then.
    timeoutStart.current = Date.now()

    window.document.addEventListener('keydown', onAnyInput)
    window.document.addEventListener('keyup', onAnyInput)
    window.document.addEventListener('mousemove', onAnyInput)
    window.document.addEventListener('mousedown', onAnyInput)
    window.document.addEventListener('mouseup', onAnyInput)
    window.document.addEventListener('scroll', onAnyInput)
    window.document.addEventListener('touchstart', onAnyInput)
    window.document.addEventListener('touchstop', onAnyInput)

    return () => {
      timeoutStart.current = null
      window.document.removeEventListener('keydown', onAnyInput)
      window.document.removeEventListener('keyup', onAnyInput)
      window.document.removeEventListener('mousemove', onAnyInput)
      window.document.removeEventListener('mousedown', onAnyInput)
      window.document.removeEventListener('mouseup', onAnyInput)
      window.document.removeEventListener('scroll', onAnyInput)
      window.document.removeEventListener('touchstart', onAnyInput)
      window.document.removeEventListener('touchstop', onAnyInput)
    }
  }, [streamIdleMode, engineStreamState.value])

  const isNetworkOkay =
    overallState === NetworkHealthState.Ok ||
    overallState === NetworkHealthState.Weak

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isNetworkOkay) return
    if (!engineStreamState.context.videoRef.current) return
    if (modelingMachineState.matches('Sketch')) return
    if (modelingMachineState.matches({ idle: 'showPlanes' })) return

    if (btnName(e).left) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sendSelectEventToEngine(e, engineStreamState.context.videoRef.current)
    }
  }

  return (
    <div
      className="absolute inset-0 z-0"
      id="stream"
      data-testid="stream"
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
      onContextMenuCapture={(e) => e.preventDefault()}
    >
      <video
        autoPlay
        muted
        key={engineStreamActor.id + 'video'}
        ref={engineStreamState.context.videoRef}
        controls={false}
        className="cursor-pointer"
        disablePictureInPicture
        id="video-stream"
      />
      <canvas
        key={engineStreamActor.id + 'canvas'}
        ref={engineStreamState.context.canvasRef}
        className="cursor-pointer"
        id="freeze-frame"
      >
        No canvas support
      </canvas>
      <ClientSideScene
        cameraControls={settings.context.modeling.mouseControls.current}
      />
    </div>
  )
}
