import type { MouseEventHandler } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
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
import { useOnPeerConnectionClose } from '@src/hooks/network/useOnPeerConnectionClose'
import { useOnWindowOnlineOffline } from '@src/hooks/network/useOnWindowOnlineOffline'
import { useOnFileRoute } from '@src/hooks/network/useOnFileRoute'
import type { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'
import { useRouteLoaderData } from 'react-router-dom'
import { createThumbnailPNGOnDesktop } from '@src/lib/screenshot'
import { PATHS } from '@src/lib/paths'
import type { IndexLoaderData } from '@src/lib/types'
import { useOnVitestEngineOnline } from '@src/hooks/network/useOnVitestEngineOnline'
import { useOnOfflineToExitSketchMode } from '@src/hooks/network/useOnOfflineToExitSketchMode'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { EngineDebugger } from '@src/lib/debugger'
import { getResolvedTheme, Themes } from '@src/lib/theme'

const TIME_TO_CONNECT = 30_000

// Object defined outside of React to prevent rerenders
const systemDeps = {
  engineCommandManager,
  kclManager,
  sceneInfra,
}

export const ConnectionStream = (props: {
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
  const settingsEngine: SettingsViaQueryString = useMemo(
    () => ({
      theme: settings.app.theme.current,
      enableSSAO: settings.modeling.enableSSAO.current,
      highlightEdges: settings.modeling.highlightEdges.current,
      showScaleGrid: settings.modeling.showScaleGrid.current,
      cameraProjection: settings.modeling.cameraProjection.current,
      cameraOrbit: settings.modeling.cameraOrbit.current,
    }),
    [
      settings.app.theme.current,
      settings.modeling.enableSSAO.current,
      settings.modeling.highlightEdges.current,
      settings.modeling.showScaleGrid.current,
      settings.modeling.cameraProjection.current,
      settings.modeling.cameraOrbit.current,
    ]
  )

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (!isNetworkOkay) return
      if (!videoRef.current) return
      // If we're in sketch mode, don't send a engine-side select event
      if (modelingMachineState.matches('Sketch')) return

      // If we're mousing up from a camera drag, don't send a select event
      if (sceneInfra.camControls.wasDragging === true) return

      if (btnName(e.nativeEvent).left) {
        sendSelectEventToEngine(e, videoRef.current, {
          engineCommandManager,
        }).catch(reportRejection)
      }
    },
    [isNetworkOkay, modelingMachineState.value]
  )

  /**
   * On double-click of sketch entities we automatically enter sketch mode with the selected sketch,
   * allowing for quick editing of sketches. TODO: This should be moved to a more central place.
   */
  const enterSketchModeIfSelectingSketch: MouseEventHandler<HTMLDivElement> =
    useCallback(
      (e) => {
        if (
          !isNetworkOkay ||
          !videoRef.current ||
          modelingMachineState.matches('Sketch') ||
          sceneInfra.camControls.wasDragging === true ||
          !btnName(e.nativeEvent).left
        ) {
          return
        }

        sendSelectEventToEngine(e, videoRef.current, {
          engineCommandManager,
        })
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
              {
                key: entity_id,
                types: ['path', 'solid2d', 'segment', 'helix'],
              },
              kclManager.artifactGraph
            )
            if (err(path)) {
              return path
            }
            sceneInfra.modelingSend({ type: 'Enter sketch' })
          })
          .catch(reportRejection)
      },
      [isNetworkOkay, modelingMachineState.value]
    )

  // TODO: Handle PingPong checks

  const onPageMountedParams = useMemo(
    () => ({
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
          sceneInfra,
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
    }),
    [
      isConnecting.current,
      numberOfConnectionAttempts.current,
      props.authToken,
      setIsSceneReady,
      setAppState,
    ]
  )

  const { resetGlobalEngineCommandManager } =
    useOnPageMounted(onPageMountedParams)

  // TODO: When exiting the page via the router teardown the engineCommandManager
  // Gotcha: If you do it too quickly listenToDarkModeMatcher will complain.
  const onPageExitParams = useMemo(
    () => ({
      callback: resetGlobalEngineCommandManager,
      engineCommandManager: engineCommandManager,
      sceneInfra: sceneInfra,
    }),
    []
  )
  useOnPageExit(onPageExitParams)

  const onPageResizeParams = useMemo(
    () => ({
      videoWrapperRef,
      videoRef,
      canvasRef,
      engineCommandManager,
    }),
    []
  )
  useOnPageResize(onPageResizeParams)

  const onPageIdleStartCb = useCallback(() => {
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
      sceneInfra,
    }).catch((e) => {
      console.warn(e)
      setShowManualConnect(true)
    })
  }, [isConnecting, numberOfConnectionAttempts, props.authToken])

  const onPageIdleParams = useMemo(
    () => ({
      startCallback: onPageIdleStartCb,
      idleCallback: () => {
        isIdle.current = true
      },
    }),
    [onPageIdleStartCb]
  )
  useOnPageIdle(onPageIdleParams)

  const onWebSocketCloseParams = useMemo(
    () => ({
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
          sceneInfra,
        }).catch((e) => {
          console.warn(e)
          setShowManualConnect(true)
        })
      },
      infiniteDetectionLoopCallback: () => {
        setShowManualConnect(true)
      },
      engineCommandManager,
    }),
    [isConnecting, numberOfConnectionAttempts, props.authToken]
  )
  useOnWebsocketClose(onWebSocketCloseParams)

  const onVitestEngineOnline = useMemo(
    () => ({
      engineCommandManager,
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
          sceneInfra,
        }).catch((e) => {
          console.warn(e)
          setShowManualConnect(true)
        })
      },
    }),
    [isConnecting, numberOfConnectionAttempts, props.authToken]
  )
  useOnVitestEngineOnline(onVitestEngineOnline)

  const onPeerConnectionCloseParams = useMemo(
    () => ({
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
          sceneInfra,
        }).catch((e) => {
          console.warn(e)
          setShowManualConnect(true)
        })
      },
      engineCommandManager,
    }),
    [isConnecting, numberOfConnectionAttempts, props.authToken]
  )
  useOnPeerConnectionClose(onPeerConnectionCloseParams)

  const onWindowOnlineOfflineParams = useMemo(
    () => ({
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
          sceneInfra,
        }).catch((e) => {
          console.warn(e)
          setShowManualConnect(true)
        })
      },
    }),
    [isConnecting, numberOfConnectionAttempts, props.authToken]
  )
  useOnWindowOnlineOffline(onWindowOnlineOfflineParams)

  const onFileRouteParams = useMemo(
    () => ({
      file,
      isStreamAcceptingInput,
      resetCameraPosition,
      systemDeps,
    }),
    [file, isStreamAcceptingInput]
  )
  useOnFileRoute(onFileRouteParams)

  const onOfflineToExitSketchModeParams = useMemo(
    () => ({
      callback: () => {
        modelingSend({ type: 'Cancel' })
      },
      engineCommandManager,
    }),
    [modelingSend]
  )
  useOnOfflineToExitSketchMode(onOfflineToExitSketchModeParams)

  // Hardcoded engine background color based on theme
  const style = useMemo(
    () => ({
      backgroundColor:
        getResolvedTheme(settings.app.theme.current) === Themes.Light
          ? 'rgb(250, 250, 250)'
          : 'rgb(30, 30, 30)',
    }),
    [settings.app.theme.current]
  )

  const viewControlContextMenuGuard: (e: MouseEvent) => boolean = useCallback(
    (e: MouseEvent) =>
      sceneInfra.camControls.wasDragging === false && btnName(e).right === true,
    []
  )

  return (
    <div
      role="presentation"
      ref={videoWrapperRef}
      className="absolute inset-[-4px] z-0"
      style={style}
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
        guard={viewControlContextMenuGuard}
        menuTargetElement={videoWrapperRef}
      />
      {(!isSceneReady || showManualConnect) && (
        <Loading
          isRetrying={false}
          retryAttemptCountdown={0}
          dataTestId="loading-engine"
          className="absolute inset-0 h-screen"
          showManualConnect={showManualConnect}
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
              sceneInfra,
            }).catch((e) => {
              console.warn(e)
              setShowManualConnect(true)
            })
          }}
        >
          Connecting and setting up scene...
        </Loading>
      )}
      )
    </div>
  )
}
