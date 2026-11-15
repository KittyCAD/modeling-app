import type { EntityType } from '@kittycad/lib'
import { computed, effect, signal as createSignal } from '@preact/signals-core'
import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { cameraMouseDragGuards } from '@src/lib/cameraControls'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  EngineConnectionEvents,
  getDimensions,
} from '@src/lib/engineConnection/utils'
import { createKclRuntime, type KclRuntime } from '@src/lib/kcl/runtime'
import type {
  ScenePresentationPreferences,
  SceneCameraPreferences,
  SceneAppearancePreferences,
} from '@src/lib/kcl/presentationPreferences'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import {
  connectScene,
  type SceneConnection,
  type ScenePresentation,
} from '@src/lib/scene/connection'
import {
  createSceneExecutionSettings,
  type SceneExecutionSettings,
} from '@src/lib/scene/settings'
import { isErr, reportRejection } from '@src/lib/trap'
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
  nativeSettings = createSceneExecutionSettings(() => settings.current.value),
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
  nativeSettings?: SceneExecutionSettings
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
  let video: HTMLVideoElement | undefined
  let detachVideo: (() => void) | undefined
  let stopDisconnect: (() => void) | undefined
  let stopUnits: (() => void) | undefined
  let disposed = false
  const element = document.createElement('div')
  Object.assign(element.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  })
  const dispose = async () => {
    if (disposed) return
    disposed = true
    stopDisconnect?.()
    stopUnits?.()
    detachVideo?.()
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
    if (isErr(connected)) return connected
    connection = connected
    // `isConnected` and the close listener belong to this exact connection.
    // `KclSession.current` rejects callbacks from an attempt replaced by recovery.
    const ownedConnection = manager.connection
    const disconnect = () => {
      if (!disposed && !signal.aborted)
        onDisconnect(
          new Error(
            'The engine disconnected. Return to this view to reconnect.'
          )
        )
    }
    ownedConnection?.addEventListener(EngineConnectionEvents.Closed, disconnect)
    stopDisconnect = () =>
      ownedConnection?.removeEventListener(
        EngineConnectionEvents.Closed,
        disconnect
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
    const { SceneInfra: Infra } = await import(
      '@src/clientSideScene/sceneInfra'
    )
    if (signal.aborted) {
      await dispose()
      return new Error('The KCL scene closed')
    }
    infra = new Infra(manager, wasm, () => settings.current.peek())
    const sceneInfra = infra
    const model = runtime
    // `SceneInfra.baseUnit` controls client-side coordinate conversion even
    // without a local model renderer. Unit changes do not replay camera preferences.
    stopUnits = effect(() => {
      sceneInfra.baseUnit = preferences.defaultUnit.value
    })
    const camera = sceneInfra.camControls
    camera.localCameraMode = presentation === 'local'
    if (camera.localCameraMode) camera.resetLocalCameraToDefaultView()
    if (presentation === 'streamed') {
      video = document.createElement('video')
      video.autoplay = true
      video.muted = true
      video.playsInline = true
      Object.assign(video.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      })
      const attached = connection.attachVideo(video)
      if (isErr(attached)) {
        await dispose()
        return attached
      }
      detachVideo = attached
      element.appendChild(video)
    }
    Object.assign(sceneInfra.renderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '2',
    })
    element.append(
      sceneInfra.renderer.domElement,
      sceneInfra.labelRenderer.domElement
    )
    const resize = async (nextSize: { width: number; height: number }) => {
      if (
        disposed ||
        signal.aborted ||
        nextSize.width < 4 ||
        nextSize.height < 4
      )
        return
      sceneInfra.onCanvasResized()
      camera.onWindowResize()
      await connection!.resize(getDimensions(nextSize.width, nextSize.height))
    }
    // Bind GLB exports, artifacts, and camera input to this runtime. The shared
    // renderer must not obtain them from the legacy route's active editor.
    const localHost: LocalRendererHost | undefined =
      presentation === 'local'
        ? {
            executionEvents: model.events,
            executing: model.executing,
            sceneGeneration: computed(
              () => model.state.value.engineSceneGeneration
            ),
            currentSceneGeneration: () =>
              model.state.peek().engineSceneGeneration,
            selectionFilter: createSignal<EntityType[]>([
              'face',
              'edge',
              'solid3d',
            ]),
            commands: manager,
            sceneInfra,
            settingsActor: settings.actor,
            artifacts: () => model.state.peek().artifactGraph,
            defaultPlanes: () => model.state.peek().defaultPlanes,
            hasErrors: () => model.failed.peek(),
            exportModel: model.exportModel,
          }
        : undefined
    // `KclSession` also invokes `applySettings` after execution. Remember applied
    // values so a new model or an unrelated preference cannot replay camera commands.
    let appliedCamera: SceneCameraPreferences | undefined
    let appliedAppearance: SceneAppearancePreferences | undefined
    const applySettings = async () => {
      if (disposed || signal.aborted) return
      const nextCamera = preferences.camera.peek()
      const nextAppearance = preferences.appearance.peek()
      if (appliedCamera?.mouseControls !== nextCamera.mouseControls)
        camera.interactionGuards =
          cameraMouseDragGuards[nextCamera.mouseControls]
      if (
        appliedCamera?.enableTouchControls !== nextCamera.enableTouchControls
      ) {
        camera.enableTouchControls = nextCamera.enableTouchControls
        camera.initTouchControls(nextCamera.enableTouchControls)
      }
      if (appliedCamera?.cameraProjection !== nextCamera.cameraProjection)
        await camera.setCameraProjection(nextCamera.cameraProjection)
      appliedCamera = nextCamera
      if (appliedAppearance?.theme !== nextAppearance.theme) {
        sceneInfra.theme = nextAppearance.theme
        if (presentation === 'streamed')
          await manager.setTheme(nextAppearance.theme)
      }
      if (
        presentation === 'streamed' &&
        appliedAppearance?.viewportRendering !==
          nextAppearance.viewportRendering
      )
        manager.setViewportRendering(nextAppearance.viewportRendering)
      appliedAppearance = nextAppearance
    }
    sceneInfra.animate()
    return {
      element,
      runtime,
      presentation,
      localHost,
      preferences,
      resize,
      applySettings,
      frameModel: async () => {
        if (!disposed && !signal.aborted && presentation === 'streamed')
          await resetCameraPosition({
            sceneInfra,
            settingsActor: settings.actor,
          })
      },
      isConnected: () =>
        !disposed && manager.isReady && manager.connection === ownedConnection,
      resume: () => {
        if (!disposed && video) void video.play().catch(reportRejection)
      },
      dispose,
    }
  } catch (cause) {
    await dispose()
    return isErr(cause)
      ? cause
      : new Error('Unable to open the KCL scene', { cause })
  }
}
export type OpenKclScene = (
  size: { width: number; height: number },
  signal: AbortSignal,
  onDisconnect: (error: Error) => void
) => Promise<KclSceneResource | Error>
