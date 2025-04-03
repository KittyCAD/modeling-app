import { useAppState } from '@src/AppState'
import { ClientSideScene } from '@src/clientSideScene/ClientSideSceneComp'
import { ViewControlContextMenu } from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { getArtifactOfTypes } from '@src/lang/std/artifactGraph'
import { EngineCommandManagerEvents } from '@src/lang/std/engineConnection'
import { btnName } from '@src/lib/cameraControls'
import { PATHS } from '@src/lib/paths'
import { sendSelectEventToEngine } from '@src/lib/selections'
import {
  engineCommandManager,
  kclManager,
  sceneInfra,
} from '@src/lib/singletons'
import { REASONABLE_TIME_TO_REFRESH_STREAM_SIZE } from '@src/lib/timings'
import { err, reportRejection, trap } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import { engineStreamActor, useSettings } from '@src/machines/appMachine'
import { useCommandBarState } from '@src/machines/commandBarMachine'
import {
  EngineStreamState,
  EngineStreamTransition,
} from '@src/machines/engineStreamMachine'

import { useSelector } from '@xstate/react'
import type { MouseEventHandler } from 'react'
import { useEffect, useRef } from 'react'
import { useRouteLoaderData } from 'react-router-dom'

export const EngineStream = (props: {
  pool: string | null
  authToken: string | undefined
}) => {
  const { setAppState } = useAppState()

  const { overallState } = useNetworkContext()
  const settings = useSettings()

  const engineStreamState = useSelector(engineStreamActor, (state) => state)

  const { file } = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const last = useRef<number>(Date.now())
  const videoWrapperRef = useRef<HTMLDivElement>(null)

  const settingsEngine = {
    theme: settings.app.theme.current,
    enableSSAO: settings.modeling.enableSSAO.current,
    highlightEdges: settings.modeling.highlightEdges.current,
    showScaleGrid: settings.modeling.showScaleGrid.current,
    cameraProjection: settings.modeling.cameraProjection.current,
  }

  const { state: modelingMachineState, send: modelingMachineActorSend } =
    useModelingContext()

  const commandBarState = useCommandBarState()

  const streamIdleMode = settings.app.streamIdleMode.current

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

  const play = () => {
    engineStreamActor.send({
      type: EngineStreamTransition.Play,
    })
  }

  useEffect(() => {
    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.SceneReady,
      play
    )

    engineStreamActor.send({
      type: EngineStreamTransition.SetPool,
      data: { pool: props.pool },
    })
    engineStreamActor.send({
      type: EngineStreamTransition.SetAuthToken,
      data: { authToken: props.authToken },
    })

    return () => {
      engineCommandManager.tearDown()
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.SceneReady,
        play
      )
    }
  }, [])

  // In the past we'd try to play immediately, but the proper thing is to way
  // for the 'canplay' event to tell us data is ready.
  useEffect(() => {
    const videoRef = engineStreamState.context.videoRef.current
    if (!videoRef) {
      return
    }
    const play = () => {
      videoRef.play().catch(console.error)
    }
    videoRef.addEventListener('canplay', play)
    return () => {
      videoRef.removeEventListener('canplay', play)
    }
  }, [engineStreamState.context.videoRef.current])

  useEffect(() => {
    if (engineStreamState.value === EngineStreamState.Reconfiguring) return
    const video = engineStreamState.context.videoRef?.current
    if (!video) return
    const canvas = engineStreamState.context.canvasRef?.current
    if (!canvas) return

    new ResizeObserver(() => {
      // Prevents:
      // `Uncaught ResizeObserver loop completed with undelivered notifications`
      window.requestAnimationFrame(() => {
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
      })
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
    startOrReconfigureEngine()
  }, Object.values(settingsEngine))

  /**
   * Subscribe to execute code when the file changes
   * but only if the scene is already ready.
   * See onSceneReady for the initial scene setup.
   */
  useEffect(() => {
    if (engineCommandManager.engineConnection?.isReady() && file?.path) {
      console.log('file changed, executing code')
      kclManager.executeCode(true).catch(trap)
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
      sendSelectEventToEngine(e)
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

    sendSelectEventToEngine(e)
      .then(({ entity_id }) => {
        if (!entity_id) {
          // No entity selected. This is benign
          return
        }
        const path = getArtifactOfTypes(
          { key: entity_id, types: ['path', 'solid2d', 'segment', 'helix'] },
          kclManager.artifactGraph
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
        cameraControls={settings.modeling.mouseControls.current}
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
