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
import { useOnWebsocketClose } from '@src/hooks/network/useOnWebsocketClose'
import { ManualReconnection } from '@src/components/ManualReconnection'
import { useOnPeerConnectionClose } from '@src/hooks/network/useOnPeerConnectionClose'
import { useOnWindowOnlineOffline } from '@src/hooks/network/useOnWindowOnlineOffline'
import { useOnFileRoute } from '@src/hooks/network/useOnFileRoute'
import type { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'
import { useRouteLoaderData, useSearchParams } from 'react-router-dom'
import env from '@src/env'
import { createThumbnailPNGOnDesktop } from '@src/lib/screenshot'
import { PATHS } from '@src/lib/paths'
import type { IndexLoaderData } from '@src/lib/types'
import { useOnVitestEngineOnline } from '@src/hooks/network/useOnVitestEngineOnline'
import { useOnOfflineToExitSketchMode } from '@src/hooks/network/useOnOfflineToExitSketchMode'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { EngineDebugger } from '@src/lib/debugger'

const TIME_TO_CONNECT = 30_000

export const ConnectionStream = (props: {
  pool: string | null
  authToken: string | undefined
}) => {
  const [showManualConnect, setShowManualConnect] = useState(false)
  const isIdle = useRef(false)
  const [isSceneReady, setIsSceneReady] = useState(false)
  const settings = useSettings()
  const { isStreamAcceptingInput, setAppState } = useAppState()
  const { overallState } = useNetworkContext()
  const { state: modelingMachineState, send: modelingSend } =
    useModelingContext()
  const { file, project } = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const id = 'engine-stream'
  // These will be passed to the engineStreamActor to handle.
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // For attaching right-click menu events
  const videoWrapperRef = useRef<HTMLDivElement>(null)
  const isNetworkOkay =
    overallState === NetworkHealthState.Ok ||
    overallState === NetworkHealthState.Weak
  const { tryConnecting, isConnecting, numberOfConnectionAttempts } =
    useTryConnect()
  // Stream related refs and data
  const [searchParams] = useSearchParams()
  const pool = searchParams.get('pool') || env().POOL || null
  /**
   * We omit `pool` here because `engineStreamMachine` will override it anyway
   * within the `EngineStreamTransition.StartOrReconfigureEngine` Promise actor.
   */
  const settingsEngine: SettingsViaQueryString = {
    theme: settings.app.theme.current,
    enableSSAO: settings.modeling.enableSSAO.current,
    highlightEdges: settings.modeling.highlightEdges.current,
    showScaleGrid: settings.modeling.showScaleGrid.current,
    cameraProjection: settings.modeling.cameraProjection.current,
    cameraOrbit: settings.modeling.cameraOrbit.current,
    pool,
  }

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

  // TODO: Handle PingPong checks

  const { resetGlobalEngineCommandManager } = useOnPageMounted({
    callback: () => {
      setShowManualConnect(false)
      tryConnecting({
        authToken: props.authToken || '',
        videoWrapperRef,
        setAppState,
        videoRef,
        setIsSceneReady,
        isConnecting,
        numberOfConnectionAttempts,
        timeToConnect: TIME_TO_CONNECT,
        settings: settingsEngine,
        setShowManualConnect,
      })
        .then(() => {
          // Take a screen shot after the page mounts and zoom to fit runs
          if (project && project.path) {
            createThumbnailPNGOnDesktop({
              projectDirectoryWithoutEndingSlash: project.path,
            })
          }
        })
        .catch((e) => {
          console.warn(e)
          setShowManualConnect(true)
        })
    },
  })
  // TODO: When exiting the page via the router teardown the engineCommandManager
  // Gotcha: If you do it too quickly listenToDarkModeMatcher will complain.
  useOnPageExit({
    callback: resetGlobalEngineCommandManager,
    engineCommandManager: engineCommandManager,
    sceneInfra: sceneInfra,
  })
  useOnPageResize({ videoWrapperRef, videoRef, canvasRef })
  useOnPageIdle({
    startCallback: () => {
      if (!videoWrapperRef.current) return
      if (!props.authToken) return
      if (engineCommandManager.started) return

      // Do not try to restart the engine on any mouse move.
      // It needs to have been in an idle state first!
      if (!isIdle.current) return
      isIdle.current = false
      setShowManualConnect(false)
      tryConnecting({
        authToken: props.authToken || '',
        videoWrapperRef,
        setAppState,
        videoRef,
        setIsSceneReady,
        isConnecting,
        numberOfConnectionAttempts,
        timeToConnect: TIME_TO_CONNECT,
        settings: settingsEngine,
        setShowManualConnect,
      }).catch((e) => {
        console.warn(e)
        setShowManualConnect(true)
      })
    },
    idleCallback: () => {
      isIdle.current = true
    },
  })
  useOnWebsocketClose({
    callback: () => {
      setShowManualConnect(false)
      tryConnecting({
        authToken: props.authToken || '',
        videoWrapperRef,
        setAppState,
        videoRef,
        setIsSceneReady,
        isConnecting,
        numberOfConnectionAttempts,
        timeToConnect: TIME_TO_CONNECT,
        settings: settingsEngine,
        setShowManualConnect,
      }).catch((e) => {
        console.warn(e)
        setShowManualConnect(true)
      })
    },
    infiniteDetectionLoopCallback: () => {
      setShowManualConnect(true)
    },
  })
  useOnVitestEngineOnline({
    callback: () => {
      setShowManualConnect(false)
      tryConnecting({
        authToken: props.authToken || '',
        videoWrapperRef,
        setAppState,
        videoRef,
        setIsSceneReady,
        isConnecting,
        numberOfConnectionAttempts,
        timeToConnect: TIME_TO_CONNECT,
        settings: settingsEngine,
        setShowManualConnect,
      }).catch((e) => {
        console.warn(e)
        setShowManualConnect(true)
      })
    },
  })
  useOnPeerConnectionClose({
    callback: () => {
      setShowManualConnect(false)
      tryConnecting({
        authToken: props.authToken || '',
        videoWrapperRef,
        setAppState,
        videoRef,
        setIsSceneReady,
        isConnecting,
        numberOfConnectionAttempts,
        timeToConnect: TIME_TO_CONNECT,
        settings: settingsEngine,
        setShowManualConnect,
      }).catch((e) => {
        console.warn(e)
        setShowManualConnect(true)
      })
    },
  })
  useOnWindowOnlineOffline({
    close: () => {
      setShowManualConnect(true)
      EngineDebugger.addLog({
        label: 'ConnectionStream.tsx',
        message: 'window offline, calling tearDown()',
      })
      engineCommandManager.tearDown()
    },
    connect: () => {
      setShowManualConnect(false)
      tryConnecting({
        authToken: props.authToken || '',
        videoWrapperRef,
        setAppState,
        videoRef,
        setIsSceneReady,
        isConnecting,
        numberOfConnectionAttempts,
        timeToConnect: TIME_TO_CONNECT,
        settings: settingsEngine,
        setShowManualConnect,
      }).catch((e) => {
        console.warn(e)
        setShowManualConnect(true)
      })
    },
  })
  useOnFileRoute({
    file,
    isStreamAcceptingInput,
    engineCommandManager,
    kclManager,
    resetCameraPosition,
  })

  useOnOfflineToExitSketchMode({
    callback: () => {
      modelingSend({ type: 'Cancel' })
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
      <Loading
        isRetrying={false}
        retryAttemptCountdown={0}
        dataTestId="loading-engine"
        className="absolute inset-0 h-screen"
      >
        Connecting and setting up scene...
      </Loading>
      {showManualConnect && (
        <ManualReconnection
          className="absolute inset-0 h-screen"
          callback={() => {
            setShowManualConnect(false)
            tryConnecting({
              authToken: props.authToken || '',
              videoWrapperRef,
              setAppState,
              videoRef,
              setIsSceneReady,
              isConnecting,
              numberOfConnectionAttempts,
              timeToConnect: TIME_TO_CONNECT,
              settings: settingsEngine,
              setShowManualConnect,
            }).catch((e) => {
              console.warn(e)
              setShowManualConnect(true)
            })
          }}
        ></ManualReconnection>
      )}
      )
    </div>
  )
}
