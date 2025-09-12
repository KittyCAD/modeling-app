import type { MouseEventHandler } from 'react'
import { useRef, useState } from 'react'
import { ClientSideScene } from '@src/clientSideScene/ClientSideSceneComp'
import {
  engineCommandManager,
  kclManager,
  useSettings,
} from '@src/lib/singletons'
import { ViewControlContextMenu } from '@src/components/ViewControlMenu'
import { sceneInfra } from '@src/lib/singletons'
import { btnName } from '@src/lib/cameraControls'
import { err, reportRejection } from '@src/lib/trap'
import Loading from '@src/components/Loading'
import { useAppState } from '@src/AppState'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { sendSelectEventToEngine } from '@src/lib/selections'
import { getArtifactOfTypes } from '@src/lang/std/artifactGraph'
import { useOnPageExit } from '@src/hooks/network/useOnPageExit'
import { useOnPageResize } from '@src/hooks/network/useOnPageResize'
import { useOnPageIdle } from '@src/hooks/network/useOnPageIdle'
import { useTryConnect } from '@src/hooks/network/useTryConnect'
import { useOnPageMounted } from '@src/hooks/network/useOnPageMounted'

export const ConnectionStream = (props: {
  pool: string | null
  authToken: string | undefined
}) => {
  const [isSceneReady, setIsSceneReady] = useState(false)
  const settings = useSettings()
  const { setAppState } = useAppState()
  const { overallState } = useNetworkContext()
  const { state: modelingMachineState } = useModelingContext()
  const id = 'engine-stream'
  // These will be passed to the engineStreamActor to handle.
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // For attaching right-click menu events
  const videoWrapperRef = useRef<HTMLDivElement>(null)
  const isNetworkOkay =
    overallState === NetworkHealthState.Ok ||
    overallState === NetworkHealthState.Weak
  const {
    tryConnecting,
    isConnecting,
    successfullyConnected,
    numberOfConnectionAtttempts,
  } = useTryConnect()

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isNetworkOkay) return
    if (!videoRef.current) return
    // If we're in sketch mode, don't send a engine-side select event
    if (modelingMachineState.matches('Sketch')) return

    // If we're mousing up from a camera drag, don't send a select event
    if (sceneInfra.camControls.wasDragging === true) return

    if (btnName(e.nativeEvent).left) {
      sendSelectEventToEngine(e, videoRef.current).catch(reportRejection)
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
      !videoRef.current ||
      modelingMachineState.matches('Sketch') ||
      sceneInfra.camControls.wasDragging === true ||
      !btnName(e.nativeEvent).left
    ) {
      return
    }

    sendSelectEventToEngine(e, videoRef.current)
      .then((result) => {
        if (!result) {
          return
        }
        const { entity_id } = result
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

  // TODO: Handle 15 second connection window
  // TODO: Handle global 3 retry connection on any connection attempts
  // TODO: Handle global disconnections. 1. Websocket closed, 2. Run time initializations
  // TODO: Handle PingPong checks
  const { resetGlobalEngineCommandManager } = useOnPageMounted({
    callback: () => {
      tryConnecting({
        authToken: props.authToken || '',
        videoWrapperRef,
        setAppState,
        videoRef,
        setIsSceneReady,
        isConnecting,
        successfullyConnected,
        numberOfConnectionAtttempts,
        timeToConnect: 30_000,
      }).catch((e) => {
        console.error(e)
      })
    },
  })
  // TODO: When exiting the page via the router teardown the engineCommandManager
  // Gotcha: If you do it too quickly listenToDarkModeMatcher will complain.
  useOnPageExit({
    callback: resetGlobalEngineCommandManager,
  })
  useOnPageResize({ videoWrapperRef, videoRef, canvasRef })
  useOnPageIdle({
    startCallback: () => {
      if (!videoWrapperRef.current) return
      if (!props.authToken) return
      if (engineCommandManager.started) return

      tryConnecting({
        authToken: props.authToken || '',
        videoWrapperRef,
        setAppState,
        videoRef,
        setIsSceneReady,
        isConnecting,
        successfullyConnected,
        numberOfConnectionAtttempts,
        timeToConnect: 30_000,
      }).catch((e) => {
        console.error(e)
      })
    },
  })

  return (
    <div
      role="presentation"
      ref={videoWrapperRef}
      className="absolute inset-[-4px] z-0"
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
        key={id + 'video'}
        ref={videoRef}
        controls={false}
        className="w-full cursor-pointer h-full"
        disablePictureInPicture
        id="video-stream"
      />
      <canvas
        key={id + 'canvas'}
        ref={canvasRef}
        className="cursor-pointer"
        id="freeze-frame"
      >
        No canvas support
      </canvas>
      <ClientSideScene
        cameraControls={settings.modeling.mouseControls.current}
        enableTouchControls={settings.modeling.enableTouchControls.current}
      />
      <ViewControlContextMenu
        event="mouseup"
        guard={(e) =>
          sceneInfra.camControls.wasDragging === false &&
          btnName(e).right === true
        }
        menuTargetElement={videoWrapperRef}
      />
      {!isSceneReady && (
        <Loading
          isRetrying={false}
          retryAttemptCountdown={0}
          dataTestId="loading-engine"
          className="absolute inset-0 h-screen"
        >
          Connecting and setting up scene...
        </Loading>
      )}
    </div>
  )
}
