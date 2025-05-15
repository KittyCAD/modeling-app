import { TEST } from '@src/env'
import { useAppState } from '@src/AppState'
import { ClientSideScene } from '@src/clientSideScene/ClientSideSceneComp'
import { ViewControlContextMenu } from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { getArtifactOfTypes } from '@src/lang/std/artifactGraph'
import {
  EngineCommandManagerEvents,
  EngineConnectionStateType,
} from '@src/lang/std/engineConnection'
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
import { uuidv4 } from '@src/lib/utils'
import { engineStreamActor, useSettings } from '@src/lib/singletons'
import {
  EngineStreamState,
  EngineStreamTransition,
} from '@src/machines/engineStreamMachine'

import Loading from '@src/components/Loading'
import { useSelector } from '@xstate/react'
import type { MouseEventHandler } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router-dom'
import { isPlaywright } from '@src/lib/isPlaywright'
import {
  engineStreamZoomToFit,
  engineViewIsometricWithGeometryPresent,
  engineViewIsometricWithoutGeometryPresent,
} from '@src/lib/utils'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { createThumbnailPNGOnDesktop } from '@src/lib/screenshot'
import type { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'

const TIME_1_SECOND = 1000

export const EngineStream = (props: {
  pool: string | null
  authToken: string | undefined
}) => {
  const { setAppState } = useAppState()
  const settings = useSettings()
  const { state: modelingMachineState, send: modelingMachineActorSend } =
    useModelingContext()

  const { file, project } = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const last = useRef<number>(Date.now())

  const [firstPlay, setFirstPlay] = useState(true)
  const [isRestartRequestStarting, setIsRestartRequestStarting] =
    useState(false)
  const [attemptTimes, setAttemptTimes] = useState<[number, number]>([0, TIME_1_SECOND])

  // These will be passed to the engineStreamActor to handle.
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // For attaching right-click menu events
  const videoWrapperRef = useRef<HTMLDivElement>(null)

  const { overallState } = useNetworkContext()
  const engineStreamState = useSelector(engineStreamActor, (state) => state)

  /**
   * We omit `pool` here because `engineStreamMachine` will override it anyway
   * within the `EngineStreamTransition.StartOrReconfigureEngine` Promise actor.
   */
  const settingsEngine: Omit<SettingsViaQueryString, 'pool'> = {
    theme: settings.app.theme.current,
    enableSSAO: settings.modeling.enableSSAO.current,
    highlightEdges: settings.modeling.highlightEdges.current,
    showScaleGrid: settings.modeling.showScaleGrid.current,
    cameraProjection: settings.modeling.cameraProjection.current,
    cameraOrbit: settings.modeling.cameraOrbit.current,
  }

  const streamIdleMode = settings.app.streamIdleMode.current

  useEffect(() => {
    engineStreamActor.send({
      type: EngineStreamTransition.SetVideoRef,
      videoRef: { current: videoRef.current },
    })
  }, [videoRef.current])

  useEffect(() => {
    engineStreamActor.send({
      type: EngineStreamTransition.SetCanvasRef,
      canvasRef: { current: canvasRef.current },
    })
  }, [canvasRef.current])

  useEffect(() => {
    engineStreamActor.send({
      type: EngineStreamTransition.SetPool,
      pool: props.pool,
    })
  }, [props.pool])

  useEffect(() => {
    engineStreamActor.send({
      type: EngineStreamTransition.SetAuthToken,
      authToken: props.authToken,
    })
  }, [props.authToken])

  // We have to call this here because of the dependencies:
  // modelingMachineActorSend, setAppState, settingsEngine
  // It's possible to pass these in earlier but I (lee) don't want to
  // restructure this further at the moment.
  const startOrReconfigureEngine = () => {
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

  useEffect(() => {
    if (
      engineStreamState.value !== EngineStreamState.WaitingForDependencies &&
      engineStreamState.value !== EngineStreamState.Stopped
    )
      return
    startOrReconfigureEngine()
  }, [engineStreamState, setAppState])

  // I would inline this but it needs to be a function for removeEventListener.
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
    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.SceneReady,
        play
      )
    }
  }, [])

  // When the scene is ready, execute kcl!
  const executeKcl = () => {
    console.log('scene is ready, execute kcl')
    const kmp = kclManager.executeCode().catch(trap)

    if (!firstPlay) return

    setFirstPlay(false)
    // Reset the restart timeouts
    setAttemptTimes([0, TIME_1_SECOND])

    console.log('firstPlay true, zoom to fit')
    kmp
      .then(async () => {
        // Gotcha: Playwright E2E tests will be zoom_to_fit, when you try to recreate the e2e test manually
        // your localhost will do view_isometric. Turn this boolean on to have the same experience when manually
        // debugging e2e tests

        // We need a padding of 0.1 for zoom_to_fit for all E2E tests since they were originally
        // written with zoom_to_fit with padding 0.1
        const padding = 0.1
        if (isPlaywright()) {
          await engineStreamZoomToFit({ engineCommandManager, padding })
        } else {
          // If the scene is empty you cannot use view_isometric, it will not move the camera
          if (kclManager.isAstBodyEmpty(kclManager.ast)) {
            await engineViewIsometricWithoutGeometryPresent({
              engineCommandManager,
              unit:
                kclManager.fileSettings.defaultLengthUnit ||
                DEFAULT_DEFAULT_LENGTH_UNIT,
            })
          } else {
            await engineViewIsometricWithGeometryPresent({
              engineCommandManager,
              padding,
            })
          }
        }

        if (project && project.path) {
          createThumbnailPNGOnDesktop({
            projectDirectoryWithoutEndingSlash: project.path,
          })
        }
      })
      .catch(trap)
  }

  useEffect(() => {
    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.SceneReady,
      executeKcl
    )
    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.SceneReady,
        executeKcl
      )
    }
  }, [firstPlay])

  useEffect(() => {
    // We do a back-off restart, using a fibonacci sequence, since it
    // has a nice retry time curve (somewhat quick then exponential)
    const attemptRestartIfNecessary = () => {
      if (isRestartRequestStarting) return
      setIsRestartRequestStarting(true)
      setTimeout(() => {
        engineStreamState.context.videoRef.current?.pause()
        engineCommandManager.tearDown()
        startOrReconfigureEngine()
        setFirstPlay(false)
        setIsRestartRequestStarting(false)
      }, attemptTimes[0] + attemptTimes[1])
      setAttemptTimes([attemptTimes[1], attemptTimes[0] + attemptTimes[1]])
    }

    // Poll that we're connected. If not, send a reset signal.
    // Do not restart if we're in idle mode.
    const connectionCheckIntervalId = setInterval(() => {
      // SKIP DURING TESTS BECAUSE IT WILL MESS WITH REUSING THE
      // ELECTRON INSTANCE.
      if (TEST) {
        return
      }

      // Don't try try to restart if we're already connected!
      const hasEngineConnectionInst = engineCommandManager.engineConnection
      const isDisconnected =
        engineCommandManager.engineConnection?.state.type ===
        EngineConnectionStateType.Disconnected
      const inIdleMode = engineStreamState.value === EngineStreamState.Paused
      if ((hasEngineConnectionInst && !isDisconnected) || inIdleMode) return

      attemptRestartIfNecessary()
    }, TIME_1_SECOND)

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.EngineRestartRequest,
      attemptRestartIfNecessary
    )
    return () => {
      clearInterval(connectionCheckIntervalId)

      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.EngineRestartRequest,
        attemptRestartIfNecessary
      )
    }
  }, [engineStreamState, attemptTimes, isRestartRequestStarting])

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

  /**
   * Subscribe to execute code when the file changes
   * but only if the scene is already ready.
   * See onSceneReady for the initial scene setup.
   */
  useEffect(() => {
    if (engineCommandManager.engineConnection?.isReady() && file?.path) {
      console.log('file changed, executing code')
      kclManager
        .executeCode()
        .catch(trap)
        .then(() =>
          // It makes sense to also call zoom to fit here, when a new file is
          // loaded for the first time, but not overtaking the work kevin did
          // so the camera isn't moving all the time.
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'zoom_to_fit',
              object_ids: [], // leave empty to zoom to all objects
              padding: 0.1, // padding around the objects
              animated: false, // don't animate the zoom for now
            },
          })
        )
        .catch(trap)
    }
    /**
     * Watch file not file?.path. Watching the object allows us to send the same file.path back to back
     * and still trigger the executeCode() function. JS should not be doing a cache check on the file path
     * we should be putting the cache check in Rust.
     * e.g. We can call `navigate(/file/<>)` or `navigate(/file/<>/settings)` as much as we want and it will
     * trigger this workflow.
     */
  }, [file])

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
        startOrReconfigureEngine()
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
    window.document.addEventListener('touchend', onAnyInput)

    return () => {
      timeoutStart.current = null
      window.document.removeEventListener('keydown', onAnyInput)
      window.document.removeEventListener('keyup', onAnyInput)
      window.document.removeEventListener('mousemove', onAnyInput)
      window.document.removeEventListener('mousedown', onAnyInput)
      window.document.removeEventListener('mouseup', onAnyInput)
      window.document.removeEventListener('scroll', onAnyInput)
      window.document.removeEventListener('touchstart', onAnyInput)
      window.document.removeEventListener('touchend', onAnyInput)
    }
  }, [streamIdleMode, engineStreamState.value])

  // On various inputs save the camera state, in case we get disconnected.
  useEffect(() => {
    const onInput = () => {
      // Save the remote camera state to restore on stream restore.
      // Fire-and-forget because we don't know when a camera movement is
      // completed on the engine side (there are no responses to data channel
      // mouse movements.)
      sceneInfra.camControls.saveRemoteCameraState().catch(trap)
    }

    // These usually signal a user is done some sort of operation.
    window.document.addEventListener('keyup', onInput)
    window.document.addEventListener('mouseup', onInput)
    window.document.addEventListener('scroll', onInput)
    window.document.addEventListener('touchend', onInput)

    return () => {
      window.document.removeEventListener('keyup', onInput)
      window.document.removeEventListener('mouseup', onInput)
      window.document.removeEventListener('scroll', onInput)
      window.document.removeEventListener('touchend', onInput)
    }
  }, [])

  const isNetworkOkay =
    overallState === NetworkHealthState.Ok ||
    overallState === NetworkHealthState.Weak

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isNetworkOkay) return
    if (!engineStreamState.context.videoRef.current) return
    // If we're in sketch mode, don't send a engine-side select event
    if (modelingMachineState.matches('Sketch')) return

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
        ref={videoRef}
        controls={false}
        className="w-full cursor-pointer h-full"
        disablePictureInPicture
        id="video-stream"
      />
      <canvas
        key={engineStreamActor.id + 'canvas'}
        ref={canvasRef}
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
      {![
        EngineStreamState.Playing,
        EngineStreamState.Paused,
        EngineStreamState.Resuming,
      ].some((s) => s === engineStreamState.value) && (
        <Loading dataTestId="loading-engine" className="fixed inset-0 h-screen">
          Connecting to engine
        </Loading>
      )}
    </div>
  )
}
