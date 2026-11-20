import { effect } from '@preact/signals-core'
import type { CameraViewState } from '@kittycad/lib'
import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  EngineConnectionEvents,
  EngineConnectionManagerEvents,
  getDimensions,
} from '@src/lib/engineConnection/utils'
import { createKclRuntime, type KclRuntime } from '@src/lib/kcl/runtime'
import type { ScenePresentationPreferences } from '@src/lib/kcl/presentationPreferences'
import {
  createSceneElement,
  createSceneViewport,
  type SceneViewport,
} from '@src/lib/kcl/scenePresentation'
import {
  connectScene,
  type SceneConnection,
  type ScenePresentation,
} from '@src/lib/kcl/scene/connection'
import type { SceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import { isErr } from '@src/lib/trap'
import { SceneDisconnected } from '@src/lib/kcl/scene/recovery'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'

/**
 * Resources created by `openKclScene` for one connection attempt. `KclSession`
 * attaches `element`, runs `runtime`, and eventually calls `dispose`. The
 * presentation is fixed at creation; a local presentation also supplies a GLB host.
 */
export interface KclSceneResource {
  readonly element: HTMLElement
  readonly runtime: KclRuntime
  readonly presentation: ScenePresentation
  readonly localHost: LocalRendererHost | undefined
  readonly preferences: ScenePresentationPreferences
  snapshotCamera: () => CameraViewState
  restoreCamera: (view: CameraViewState) => Promise<void>
  resize: (size: { width: number; height: number }) => Promise<void>
  /** Apply the legacy initial-camera reset; `KclSession` requests it once per streamed connection. */
  frameModel: () => Promise<void>
  /** Compare the manager's live connection with the one this resource opened. */
  isConnected: () => boolean
  /** Retry video playback when `KclScene` reattaches this resource's DOM. */
  resume: () => void
  /** Apply changed camera/appearance values; execution declarations and local React props have separate consumers. */
  applySettings: () => Promise<void>
  dispose: () => Promise<void>
}

/** Build the connection, native runtime, and `SceneInfra`; return an `Error` and dispose partial startup resources on failure. */
export async function openKclScene({
  wasm,
  settings,
  preferences,
  nativeSettings,
  token,
  size,
  presentation,
  signal,
  onDisconnect,
  kclVersion,
}: {
  wasm: Promise<ModuleType>
  settings: SettingsRegistryService
  preferences: ScenePresentationPreferences
  nativeSettings: SceneExecutionSettings
  kclVersion?: KclVersion
  token: string | undefined
  size: { width: number; height: number }
  presentation: ScenePresentation
  signal: AbortSignal
  onDisconnect: (error: Error) => void
}): Promise<KclSceneResource | Error> {
  const manager = new ConnectionManager({ settingsActor: settings.actor })
  let connection: SceneConnection | undefined
  let runtime: KclRuntime | undefined
  let infra: SceneInfra | undefined
  let viewport: SceneViewport | undefined
  let connectionWatch: ReturnType<typeof watchConnection> | undefined
  let stopUnits: (() => void) | undefined
  let disposed = false
  const element = createSceneElement()
  // Startup assigns each resource as it is acquired. The same disposer handles
  // partial startup and normal closure; native disposal waits for its work queue.
  const dispose = async () => {
    if (disposed) return
    disposed = true
    connectionWatch?.dispose()
    stopUnits?.()
    viewport?.dispose()
    infra?.localRenderer?.dispose()
    if (infra) infra.localRenderer = null
    infra?.dispose()
    connection?.dispose()
    if (manager.started)
      manager.tearDown({ route: 'service-disposed', initiatedBy: 'client' })
    element.remove()
    await runtime?.dispose()
  }
  try {
    const connected = await connectScene({
      manager,
      token: token ?? '',
      size: getDimensions(size.width, size.height),
      presentation,
      signal,
      kclVersion,
      timeoutMs: 30_000,
    })
    if (isErr(connected)) {
      await dispose()
      return new SceneDisconnected(
        connected.message,
        !manager.lastConnectionError?.terminal
      )
    }
    connection = connected
    connectionWatch = watchConnection(
      manager,
      () => disposed || signal.aborted,
      onDisconnect
    )
    runtime = await createKclRuntime(
      wasm,
      manager,
      () => nativeSettings.configuration.peek(),
      () =>
        presentation === 'local' ? '' : nativeSettings.rebuildRevision.peek()
    )
    if (signal.aborted) {
      await dispose()
      return new Error('The KCL scene closed')
    }
    infra = new SceneInfra(manager, wasm, () => settings.current.peek())
    const sceneInfra = infra
    const model = runtime
    // `SceneInfra.baseUnit` controls client-side coordinate conversion even
    // without a local model renderer. Unit changes do not replay camera preferences.
    stopUnits = effect(() => {
      sceneInfra.baseUnit = preferences.defaultUnit.value
    })
    const view = createSceneViewport(
      { element, connection: connected, manager, sceneInfra, model, settings },
      presentation,
      preferences,
      () => disposed || signal.aborted
    )
    if (isErr(view)) {
      await dispose()
      return view
    }
    viewport = view
    sceneInfra.animate()
    return {
      element,
      runtime,
      presentation,
      localHost: view.localHost,
      preferences,
      snapshotCamera: () => sceneInfra.camControls.snapshotCameraView(),
      restoreCamera: (view) =>
        sceneInfra.camControls.setCameraView({
          ...view,
          is_ortho:
            preferences.camera.peek().cameraProjection === 'orthographic',
        }),
      resize: view.resize,
      applySettings: view.applySettings,
      frameModel: view.frameModel,
      isConnected: connectionWatch.isConnected,
      resume: view.resume,
      dispose,
    }
  } catch (cause) {
    await dispose()
    return isErr(cause)
      ? cause
      : new Error('Unable to open the KCL scene', { cause })
  }
}

/** Subscribe to the captured connection; neither health checks nor listener removal should switch to a replacement on the manager. */
function watchConnection(
  manager: ConnectionManager,
  isClosed: () => boolean,
  onDisconnect: (error: Error) => void
) {
  const ownedConnection = manager.connection
  const disconnect = (event: Event) => {
    if (!isClosed())
      onDisconnect(
        new SceneDisconnected(
          `Engine disconnected: ${event.type}`,
          !manager.lastConnectionError?.terminal,
          {
            eventType: event.type,
            connectionId: ownedConnection?.id,
            modelingApiCallId: ownedConnection?.apiCallId,
            pendingCommandCount: Object.keys(manager.pendingCommands).length,
            websocketBufferedAmount: ownedConnection?.websocket?.bufferedAmount,
            connectionConnected: ownedConnection?.connected,
            peerConnectionState:
              ownedConnection?.peerConnection?.connectionState,
            iceConnectionState:
              ownedConnection?.peerConnection?.iceConnectionState,
            dataChannelReadyState:
              ownedConnection?.unreliableDataChannel?.readyState,
            connectionError: manager.lastConnectionError,
          }
        )
      )
  }
  const events = [
    EngineConnectionManagerEvents.WebsocketClosed,
    EngineConnectionManagerEvents.peerConnectionClosed,
    EngineConnectionManagerEvents.peerConnectionDisconnected,
    EngineConnectionManagerEvents.peerConnectionFailed,
    EngineConnectionManagerEvents.dataChannelClose,
  ]
  for (const event of events) manager.addEventListener(event, disconnect)
  ownedConnection?.addEventListener(EngineConnectionEvents.Closed, disconnect)
  return {
    isConnected: () =>
      !isClosed() && manager.isReady && manager.connection === ownedConnection,
    dispose: () => {
      for (const event of events) manager.removeEventListener(event, disconnect)
      ownedConnection?.removeEventListener(
        EngineConnectionEvents.Closed,
        disconnect
      )
    },
  }
}

export type OpenKclScene = (
  size: { width: number; height: number },
  signal: AbortSignal,
  onDisconnect: (error: Error) => void
) => Promise<KclSceneResource | Error>
