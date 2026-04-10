import type { MouseEventHandler } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClientSideScene } from '@src/clientSideScene/ClientSideSceneComp'
import { useApp, useSingletons } from '@src/lib/boot'
import { ViewControlContextMenu } from '@src/components/ViewControlMenu'
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
import { createThumbnailPNGOnDesktop } from '@src/lib/screenshot'
import { useOnVitestEngineOnline } from '@src/hooks/network/useOnVitestEngineOnline'
import { useOnOfflineToExitSketchMode } from '@src/hooks/network/useOnOfflineToExitSketchMode'
import { EngineDebugger } from '@src/lib/debugger'
import { getResolvedTheme, Themes } from '@src/lib/theme'

const TIME_TO_CONNECT = 30_000

export const ConnectionStream = (props: {
  authToken: string | undefined
  sketchSolveStreamDimming?: number
}) => {
  const { settings, project } = useApp()
  const { kclManager } = useSingletons()
  const engineCommandManager = kclManager.engineCommandManager
  const sceneInfra = kclManager.sceneInfra
  const [showManualConnect, setShowManualConnect] = useState(false)
  const isIdle = useRef(false)
  const [isSceneReady, setIsSceneReady] = useState(false)
  const settingsValues = settings.useSettings()
  const showEngineDebugOverlay = settingsValues.app.showDebugPanel.current
  const [isEngineDebugLoggingEnabled, setIsEngineDebugLoggingEnabled] =
    useState(true)
  const { setAppState } = useAppState()
  const { overallState } = useNetworkContext()
  const { state: modelingMachineState, send: modelingSend } =
    useModelingContext()
  const projectIORef = project?.projectIORefSignal.value
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
  const [engineDebugSnapshot, setEngineDebugSnapshot] = useState(() =>
    engineCommandManager.getDebugSnapshot()
  )
  const safariObjectFitClass = useMemo(() => {
    // on safari we want to apply object-fit: fill to fix video resize bug
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    return isSafari ? ' object-fill' : ''
  }, [])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isNetworkOkay,
      modelingMachineState.value,
      sceneInfra.camControls.wasDragging,
    ]
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        isNetworkOkay,
        modelingMachineState.value,
        sceneInfra.camControls.wasDragging,
        kclManager.artifactGraph,
      ]
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
          setShowManualConnect,
          sceneInfra,
          settingsActor: settings.actor,
        })
          .then(() => {
            // Take a screen shot after the page mounts and zoom to fit runs
            if (projectIORef && projectIORef.path) {
              createThumbnailPNGOnDesktop({
                projectDirectoryWithoutEndingSlash: projectIORef.path,
              })
            }
          })
          .catch((e) => {
            console.warn(e)
            setShowManualConnect(true)
          })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isConnecting.current,
      numberOfConnectionAttempts.current,
      props.authToken,
      sceneInfra.camControls.wasDragging,
      projectIORef?.path,
      settings,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    [engineCommandManager]
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
      setShowManualConnect,
      sceneInfra,
      settingsActor: settings.actor,
    }).catch((e) => {
      console.warn(e)
      setShowManualConnect(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnecting, numberOfConnectionAttempts, props.authToken, settings])

  const disconnectForIdle = useCallback(
    async (reason: 'idle-timer' | 'manual-debug-button') => {
      if (engineCommandManager.started) {
        try {
          await sceneInfra.camControls.saveRemoteCameraState()
        } catch (e) {
          console.warn('unable to save old camera state on idle', e)
          sceneInfra.camControls.clearOldCameraState()
        }
      }

      console.log(sceneInfra.camControls.oldCameraState)
      console.warn(`${reason}: tearing down connection through idle path.`)
      EngineDebugger.addLog({
        label: 'ConnectionStream.tsx',
        message: 'disconnectForIdle',
        metadata: { reason },
      })

      isIdle.current = true
      engineCommandManager.tearDown()
      setEngineDebugSnapshot(engineCommandManager.getDebugSnapshot())
    },
    [engineCommandManager, sceneInfra.camControls]
  )

  const onPageIdleParams = useMemo(
    () => ({
      startCallback: onPageIdleStartCb,
      idleCallback: () => disconnectForIdle('idle-timer'),
    }),
    [disconnectForIdle, onPageIdleStartCb]
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
          setShowManualConnect,
          sceneInfra,
          settingsActor: settings.actor,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isConnecting, numberOfConnectionAttempts, props.authToken, settings]
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
          setShowManualConnect,
          sceneInfra,
          settingsActor: settings.actor,
        }).catch((e) => {
          console.warn(e)
          setShowManualConnect(true)
        })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isConnecting, numberOfConnectionAttempts, props.authToken, settings]
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
          setShowManualConnect,
          sceneInfra,
          settingsActor: settings.actor,
        }).catch((e) => {
          console.warn(e)
          setShowManualConnect(true)
        })
      },
      engineCommandManager,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isConnecting, numberOfConnectionAttempts, props.authToken, settings]
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
          setShowManualConnect,
          sceneInfra,
          settingsActor: settings.actor,
        }).catch((e) => {
          console.warn(e)
          setShowManualConnect(true)
        })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isConnecting, numberOfConnectionAttempts, props.authToken, settings]
  )
  useOnWindowOnlineOffline(onWindowOnlineOfflineParams)

  const onOfflineToExitSketchModeParams = useMemo(
    () => ({
      callback: () => {
        modelingSend({
          type: modelingMachineState.matches('sketchSolveMode')
            ? 'Exit sketch'
            : 'Cancel',
        })
      },
      engineCommandManager,
    }),
    [modelingMachineState, modelingSend, engineCommandManager]
  )
  useOnOfflineToExitSketchMode(onOfflineToExitSketchModeParams)

  // Hardcoded engine background color based on theme
  const style = useMemo(
    () => ({
      backgroundColor:
        getResolvedTheme(settingsValues.app.theme.current) === Themes.Light
          ? 'rgb(250, 250, 250)'
          : 'rgb(30, 30, 30)',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settingsValues.app.theme.current]
  )

  const viewControlContextMenuGuard: (e: MouseEvent) => boolean = useCallback(
    (e: MouseEvent) =>
      sceneInfra.camControls.wasDragging === false && btnName(e).right === true,
    [sceneInfra.camControls.wasDragging]
  )

  useEffect(() => {
    if (!showEngineDebugOverlay || !isEngineDebugLoggingEnabled) {
      return
    }

    const pollEngineDebugSnapshot = () => {
      const snapshot = engineCommandManager.getDebugSnapshot()
      setEngineDebugSnapshot(snapshot)
      console.log('[engine-debug][500ms]', {
        ...snapshot,
        isIdle: isIdle.current,
        kclIsExecuting: kclManager.isExecuting,
      })
    }

    pollEngineDebugSnapshot()
    const intervalId = window.setInterval(pollEngineDebugSnapshot, 500)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    engineCommandManager,
    isEngineDebugLoggingEnabled,
    kclManager,
    showEngineDebugOverlay,
  ])

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
        className={`w-full cursor-pointer h-full${safariObjectFitClass}`}
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
        cameraControls={settingsValues.modeling.mouseControls.current}
        enableTouchControls={
          settingsValues.modeling.enableTouchControls.current
        }
        sketchSolveStreamDimming={props.sketchSolveStreamDimming}
      />
      <ViewControlContextMenu
        event="mouseup"
        guard={viewControlContextMenuGuard}
        menuTargetElement={videoWrapperRef}
      />
      {showEngineDebugOverlay && (
        <div
          className="absolute left-2 top-2 z-20 flex max-w-sm flex-col gap-2 rounded border border-dashed border-warn-60 bg-chalkboard-10/95 p-2 text-xs shadow-lg dark:bg-chalkboard-100/95"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div className="font-mono leading-5">
            <div>
              started: {String(engineDebugSnapshot.started)} | idle:{' '}
              {String(isIdle.current)}
            </div>
            <div>
              pending: {engineDebugSnapshot.pendingCommandCount} | ws:{' '}
              {engineDebugSnapshot.connection.websocketReadyStateLabel ??
                'none'}
            </div>
            <div>
              peer:{' '}
              {engineDebugSnapshot.connection.peerConnectionState ?? 'none'} |
              dc:{' '}
              {engineDebugSnapshot.connection.unreliableDataChannelState ??
                'none'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded border border-warn-60 bg-warn-10 px-2 py-1 text-left text-xs text-warn-80 dark:bg-warn-80 dark:text-chalkboard-10"
              data-testid="simulate-idle-disconnect"
              onClick={() => {
                disconnectForIdle('manual-debug-button').catch(reportRejection)
              }}
            >
              Simulate idle disconnect
            </button>
            <button
              className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-left text-xs text-primary dark:bg-primary/20 dark:text-chalkboard-10"
              data-testid="toggle-engine-debug-logging"
              onClick={() => {
                setIsEngineDebugLoggingEnabled((prev) => !prev)
              }}
            >
              {isEngineDebugLoggingEnabled ? 'Pause' : 'Resume'} 500ms logging
            </button>
          </div>
        </div>
      )}
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
              setShowManualConnect,
              sceneInfra,
              settingsActor: settings.actor,
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
