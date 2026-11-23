import type { KclViewControlHost } from '@src/lib/kcl/modeling/KclViewControls'
import { uuidv4 } from '@src/lib/utils'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { createKclSceneSelection } from '@src/lib/kcl/scene/sceneSelection'
import type { SceneSelectionController } from '@src/lib/kcl/scene/selection'
import { computed, effect } from '@preact/signals-core'
import type { CameraViewState } from '@kittycad/lib'
import { captureViewportScreenshot } from '@src/lib/screenshot'
import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  EngineConnectionEvents,
  EngineConnectionManagerEvents,
  getDimensions,
} from '@src/lib/engineConnection/utils'
import {
  createKclRuntime,
  type KclRuntime,
} from '@src/lib/kcl/execution/runtime'
import type { ScenePresentationPreferences } from '@src/lib/kcl/scene/presentationPreferences'
import {
  createSceneElement,
  createSceneViewport,
  type SceneViewport,
} from '@src/lib/kcl/scene/scenePresentation'
import {
  connectScene,
  type SceneConnection,
  type ScenePresentation,
} from '@src/lib/kcl/scene/connection'
import type { SceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import { isErr } from '@src/lib/trap'
import { isRecord } from '@src/lib/utils'
import { SceneDisconnected } from '@src/lib/kcl/scene/recovery'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'

/**
 * Resources created by `openKclScene` for one connection attempt. `KclSession`
 * attaches `element`, runs `runtime`, and eventually calls `dispose`. The
 * presentation is fixed at creation; a local presentation also supplies a GLB host.
 */
export interface KclSceneResource {
  readonly sceneInfra?: SceneInfra
  readonly machineInput?: {
    manager: ConnectionManager
    handoffPicking: ReturnType<typeof createKclSceneSelection>['handoff']
  }

  readonly element: HTMLElement
  readonly runtime: KclRuntime
  readonly presentation: ScenePresentation
  readonly localHost: LocalRendererHost | undefined
  readonly viewControls?: KclViewControlHost
  readonly selection: SceneSelectionController
  readonly commands: Pick<
    ConnectionManager,
    'sendSceneCommand' | 'pendingCommands'
  >
  captureScreenshot: () => string
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
  let picking: ReturnType<typeof createKclSceneSelection> | undefined
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
    picking?.dispose()
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
    runtime = await createKclRuntime(wasm, manager, () =>
      nativeSettings.configuration.peek()
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
    const selectionBinding = createKclSceneSelection(
      manager,
      sceneInfra,
      model,
      presentation
    )
    picking = selectionBinding
    const view = createSceneViewport(
      {
        element,
        connection: connected,
        manager,
        sceneInfra,
        model,
        settings,
        selection: selectionBinding.selection,
      },
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
      sceneInfra,
      machineInput: { manager, handoffPicking: selectionBinding.handoff },
      runtime,
      presentation,
      localHost: view.localHost,
      selection: selectionBinding.selection,
      commands: {
        sendSceneCommand: connected.send,
        get pendingCommands() {
          return manager.pendingCommands
        },
      },
      captureScreenshot: () =>
        disposed
          ? ''
          : captureViewportScreenshot({
              canvas: sceneInfra.renderer.domElement,
              video: view.video,
              localRenderer: sceneInfra.localRenderer,
            }),
      preferences,
      viewControls: {
        id: uuidv4(),
        sceneInfra,
        theme: computed(() => preferences.appearance.value.theme),
        gizmoType: computed(
          () => settings.current.value.modeling.gizmoType.currentSignal.value
        ),
        toggleGizmo: () =>
          settings.send({
            type: 'set.modeling.gizmoType',
            data: {
              level: 'user',
              value:
                settings.current.peek().modeling.gizmoType.current === 'axis'
                  ? 'cube'
                  : 'axis',
            },
          }),
        reset: () =>
          resetCameraPosition({ sceneInfra, settingsActor: settings.actor }),
      },
      snapshotCamera: () => sceneInfra.camControls.snapshotCameraView(),
      restoreCamera: (cameraView) => {
        // A restored camera replaces initial framing, even if the local GLB
        // finishes loading after the camera has already been restored.
        view.localHost?.claimInitialCameraFrame?.()
        return sceneInfra.camControls.setCameraView(cameraView)
      },
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
    const detail: unknown =
      event instanceof CustomEvent ? event.detail : undefined
    const close = isRecord(detail) ? detail : {}
    if (!isClosed())
      onDisconnect(
        new SceneDisconnected(
          `Engine disconnected: ${event.type}`,
          !manager.lastConnectionError?.terminal,
          {
            eventType: event.type,
            websocketCloseCode: close.code,
            reconnectRequested: close.reconnectRequested === true,
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

/** Machine hosts require the scene's native command and interaction dependencies. */
export type MachineSceneResource = KclSceneResource &
  Required<Pick<KclSceneResource, 'sceneInfra' | 'machineInput'>>
export function hasMachineInput(
  scene: KclSceneResource
): scene is MachineSceneResource {
  return !!scene.sceneInfra && !!scene.machineInput
}
