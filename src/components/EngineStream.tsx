import { MouseEventHandler, useEffect, useRef } from 'react'
import { useAppState } from 'AppState'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useModelingContext } from 'hooks/useModelingContext'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { ClientSideScene } from 'clientSideScene/ClientSideSceneComp'
import { btnName } from 'lib/cameraControls'
import { sendSelectEventToEngine } from 'lib/selections'
import { kclManager, engineCommandManager, sceneInfra } from 'lib/singletons'
import { EngineCommandManagerEvents } from 'lang/std/engineConnection'
import { useRouteLoaderData } from 'react-router-dom'
import { PATHS } from 'lib/paths'
import { IndexLoaderData } from 'lib/types'
import { err, reportRejection, trap } from 'lib/trap'
import { getArtifactOfTypes } from 'lang/std/artifactGraph'
import { ViewControlContextMenu } from './ViewControlMenu'
import { commandBarActor, useCommandBarState } from 'machines/commandBarMachine'
import { useSelector } from '@xstate/react'
import useEngineStreamContext, {
  EngineStreamState,
  EngineStreamTransition,
} from 'hooks/useEngineStreamContext'
import { REASONABLE_TIME_TO_REFRESH_STREAM_SIZE } from 'lib/timings'

export const EngineStream = () => {
  const { setAppState } = useAppState()

  const { overallState } = useNetworkContext()
  const { settings } = useSettingsAuthContext()
  const { file } = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const last = useRef<number>(Date.now())
  const videoWrapperRef = useRef<HTMLDivElement>(null)

  const settingsEngine = {
    theme: settings.context.app.theme.current,
    enableSSAO: settings.context.app.enableSSAO.current,
    highlightEdges: settings.context.modeling.highlightEdges.current,
    showScaleGrid: settings.context.modeling.showScaleGrid.current,
    cameraProjection: settings.context.modeling.cameraProjection.current,
  }

  const { state: modelingMachineState, send: modelingMachineActorSend } =
    useModelingContext()

  const commandBarState = useCommandBarState()

  const engineStreamActor = useEngineStreamContext.useActorRef()
  const engineStreamState = engineStreamActor.getSnapshot()

  const streamIdleMode = settings.context.app.streamIdleMode.current

  const startOrReconfigureEngine = () => {
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
    const video = engineStreamState.context.videoRef?.current
    if (!video) return
    const canvas = engineStreamState.context.canvasRef?.current
    if (!canvas) return

    new ResizeObserver(() => {
      if (Date.now() - last.current < REASONABLE_TIME_TO_REFRESH_STREAM_SIZE)
        return
      last.current = Date.now()

      if (
        Math.abs(video.width - window.innerWidth) > 4 ||
        Math.abs(video.height - window.innerHeight) > 4
      ) {
        timeoutStart.current = Date.now()
        startOrReconfigureEngine()
      }
    }).observe(document.body)
  }, [engineStreamState.value])

  // When the video and canvas element references are set, start the engine.
  useEffect(() => {
    if (
      engineStreamState.context.canvasRef.current &&
      engineStreamState.context.videoRef.current
    ) {
      startOrReconfigureEngine()
    }
  }, [
    engineStreamState.context.canvasRef.current,
    engineStreamState.context.videoRef.current,
  ])

  // On settings change, reconfigure the engine. When paused this gets really tricky,
  // and also requires onMediaStream to be set!
  useEffect(() => {
    if (engineStreamState.value === EngineStreamState.Playing) {
      startOrReconfigureEngine()
    }
  }, [settings.context, engineStreamState.value])

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
    let frameId: ReturnType<typeof window.requestAnimationFrame> = 0
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
    // If we're in sketch mode, don't send a engine-side select event
    if (modelingMachineState.matches('Sketch')) return
    // Only respect default plane selection if we're on a selection command argument
    if (
      modelingMachineState.matches({ idle: 'showPlanes' }) &&
      !(
        commandBarState.matches('Gathering arguments') &&
        commandBarState.context.currentArgument?.inputType === 'selection'
      )
    )
      return
    // If we're mousing up from a camera drag, don't send a select event
    if (sceneInfra.camControls.wasDragging === true) return

    if (btnName(e.nativeEvent).left) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      sendSelectEventToEngine(e, engineStreamState.context.videoRef.current)
    }
  }

  /**
   * On double-click of sketch entities we automatically enter sketch mode with the selected sketch,
   * allowing for quick editing of sketches. TODO: This should be moved to a more central place.
   */
  const enterSketchModeIfSelectingSketch: MouseEventHandler<HTMLDivElement> = (
    e
  ) => {
    if (
      !isNetworkOkay ||
      !engineStreamState.context.videoRef.current ||
      modelingMachineState.matches('Sketch') ||
      modelingMachineState.matches({ idle: 'showPlanes' }) ||
      sceneInfra.camControls.wasDragging === true ||
      !btnName(e.nativeEvent).left
    ) {
      return
    }

    sendSelectEventToEngine(e, engineStreamState.context.videoRef.current)
      .then(({ entity_id }) => {
        if (!entity_id) {
          // No entity selected. This is benign
          return
        }
        const path = getArtifactOfTypes(
          { key: entity_id, types: ['path', 'solid2d', 'segment', 'helix'] },
          engineCommandManager.artifactGraph
        )
        if (err(path)) {
          return path
        }
        sceneInfra.modelingSend({ type: 'Enter sketch' })
      })
      .catch(reportRejection)
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={videoWrapperRef}
      className="absolute inset-0 z-0"
      id="stream"
      data-testid="stream"
      onMouseUp={handleMouseUp}
      onDoubleClick={enterSketchModeIfSelectingSketch}
      onContextMenu={(e) => e.preventDefault()}
      onContextMenuCapture={(e) => e.preventDefault()}
    >
      <video
        autoPlay
        muted
        key={engineStreamActor.id + 'video'}
        ref={engineStreamState.context.videoRef}
        controls={false}
        className="w-full cursor-pointer h-full"
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
      <ViewControlContextMenu
        event="mouseup"
        guard={(e) =>
          sceneInfra.camControls.wasDragging === false &&
          btnName(e).right === true
        }
        menuTargetElement={videoWrapperRef}
      />
    </div>
  )
}
