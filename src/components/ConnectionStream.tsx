import type { MouseEventHandler } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
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
import {
  normalizeEntityReference,
  sendQueryEntityTypeWithPoint,
} from '@src/lib/selections'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
} from '@src/lang/std/artifactGraph'
import type { EntityReference } from '@src/machines/modelingSharedTypes'
import { artifactToEntityRef } from '@src/lang/queryAst'
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
}) => {
  const { settings, project } = useApp()
  const { kclManager } = useSingletons()
  const engineCommandManager = kclManager.engineCommandManager
  const sceneInfra = kclManager.sceneInfra
  const [showManualConnect, setShowManualConnect] = useState(false)
  const isIdle = useRef(false)
  const [isSceneReady, setIsSceneReady] = useState(false)
  const settingsValues = settings.useSettings()
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
        sendQueryEntityTypeWithPoint(e, videoRef.current, {
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
        const log = (msg: string, data?: object) => {
          const line = data ? `${msg} ${JSON.stringify(data)}` : msg
          console.warn(`[double-click-edit] ${line}`)
          if (
            typeof window !== 'undefined' &&
            (window as any).__doubleClickEditLog
          ) {
            ;(window as any).__doubleClickEditLog.push(line)
          }
        }
        log('onDoubleClick fired')
        if (
          !isNetworkOkay ||
          !videoRef.current ||
          modelingMachineState.matches('Sketch') ||
          sceneInfra.camControls.wasDragging === true ||
          !btnName(e.nativeEvent).left
        ) {
          log('early return', {
            isNetworkOkay,
            hasVideoRef: !!videoRef.current,
            matchesSketch: modelingMachineState.matches('Sketch'),
            wasDragging: sceneInfra.camControls.wasDragging,
            left: btnName(e.nativeEvent).left,
          })
          return
        }

        log('Sending query_entity_type_with_point')
        sendQueryEntityTypeWithPoint(e, videoRef.current, {
          engineCommandManager,
        })
          .then((result) => {
            if (!result) {
              log('No result from query_entity_type_with_point')
              return
            }
            // Support both legacy entity_id and Face API reference response
            let entityId: string | undefined = (
              result as { entity_id?: string }
            ).entity_id
            if (!entityId && (result as { reference?: unknown }).reference) {
              const entityRef = normalizeEntityReference(
                (result as { reference: unknown }).reference
              )
              if (entityRef) {
                if (entityRef.type === 'plane') entityId = entityRef.plane_id
                else if (entityRef.type === 'face') entityId = entityRef.face_id
                else if (entityRef.type === 'solid2d')
                  entityId = entityRef.solid2d_id
                else if (entityRef.type === 'solid3d')
                  entityId = entityRef.solid3d_id
                else if (entityRef.type === 'solid2d_edge')
                  entityId = entityRef.edge_id
                else if (entityRef.type === 'segment')
                  entityId = entityRef.segment_id
                else if (
                  entityRef.type === 'edge' &&
                  entityRef.side_faces.length > 0
                ) {
                  entityId = entityRef.side_faces[0]
                } else if (
                  entityRef.type === 'vertex' &&
                  entityRef.side_faces.length > 0
                ) {
                  entityId = entityRef.side_faces[0]
                }
              }
              // Fallback: engine may return path or segment with different shape; use raw ref for artifact lookup
              if (!entityId && (result as { reference?: unknown }).reference) {
                const ref = (result as { reference: unknown })
                  .reference as Record<string, unknown>
                const refType = String(ref?.type).toLowerCase()
                if (refType === 'path') {
                  const pathId = ref.path_id ?? ref.pathId
                  if (typeof pathId === 'string') entityId = pathId
                } else if (refType === 'segment') {
                  const segmentId = ref.segment_id ?? ref.segmentId
                  if (typeof segmentId === 'string') entityId = segmentId
                } else if (refType === 'helix') {
                  const helixId = ref.helix_id ?? ref.helixId ?? ref.id
                  if (typeof helixId === 'string') entityId = helixId
                }
              }
            }
            if (!entityId) {
              log('No entityId from result', {
                keys: Object.keys(result),
                hasReference: !!(result as { reference?: unknown }).reference,
              })
              return
            }
            const artifactResult = getArtifactOfTypes(
              {
                key: entityId,
                types: ['path', 'solid2d', 'segment', 'helix'],
              },
              kclManager.artifactGraph
            )
            if (err(artifactResult)) {
              log('getArtifactOfTypes failed', {
                error: String(artifactResult),
                entityId,
              })
              return artifactResult
            }
            const artifact = artifactResult
            // Build entityRef so the machine can resolve the selection (Enter sketch uses selection)
            const pathIdForSegment =
              artifact.type === 'segment'
                ? (artifact as { pathId: string }).pathId
                : undefined
            let entityRef: EntityReference | undefined = artifactToEntityRef(
              artifact.type,
              entityId,
              pathIdForSegment
            )
            if (!entityRef) {
              if (artifact.type === 'path') {
                entityRef = { type: 'solid2d', solid2d_id: String(artifact.id) }
              } else if (artifact.type === 'helix') {
                entityRef = {
                  type: 'solid2d_edge',
                  edge_id: String(artifact.id),
                }
              }
            }
            if (!entityRef) return
            const codeRef = getCodeRefsByArtifactId(
              entityId,
              kclManager.artifactGraph
            )?.[0]
            log('Setting selection and Enter sketch')
            sceneInfra.modelingSend({
              type: 'Set selection',
              data: {
                selectionType: 'singleCodeCursor',
                selection: { entityRef, codeRef },
              },
            })
            sceneInfra.modelingSend({ type: 'Enter sketch' })
          })
          .catch((e) => {
            log('Query/reason failed', { err: String(e) })
            reportRejection(e)
          })
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
        modelingSend({ type: 'Cancel' })
      },
      engineCommandManager,
    }),
    [modelingSend, engineCommandManager]
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
