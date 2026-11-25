import type { SceneSelectionController } from '@src/lib/kcl/scene/selection'
import { computed } from '@preact/signals-core'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import {
  createCameraInputApplier,
  applySceneOverlayTheme,
} from '@src/lib/kcl/scene/applyPreferences'
import {
  observeViewportDensity,
  streamVideoObjectFit,
  resizeSceneCanvas,
} from '@src/lib/kcl/scene/viewport'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { getDimensions } from '@src/lib/engineConnection/utils'
import type { KclRuntime } from '@src/lib/kcl/execution/runtime'
import type {
  ScenePresentationPreferences,
  SceneCameraPreferences,
  SceneAppearancePreferences,
} from '@src/lib/kcl/scene/presentationPreferences'
import styles from './scenePresentation.module.css'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import type {
  SceneConnection,
  ScenePresentation,
} from '@src/lib/kcl/scene/connection'
import { isErr, reportRejection } from '@src/lib/trap'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'

/** The DOM attached by `KclSession`; video, the Three.js canvas, and labels share its bounds. */
export function createSceneElement() {
  const element = document.createElement('div')
  element.className = styles.viewport
  // Zoo camera controls use right-button drags; the browser menu interrupts
  // their pointer sequence. Match the legacy ConnectionStream surface.
  element.addEventListener('contextmenu', (event) => event.preventDefault())
  return element
}

/** Dependencies borrowed from `openKclScene`; presentation disposal does not close them. */
interface PresentationContext {
  element: HTMLElement
  connection: SceneConnection
  manager: ConnectionManager
  sceneInfra: SceneInfra
  selection: SceneSelectionController
  model: KclRuntime
  settings: SettingsRegistryService
}

/** Operations whose implementation differs between engine video and local model rendering. */
interface PresentationAdapter {
  localHost: LocalRendererHost | undefined
  video: HTMLVideoElement | undefined
  applyAppearance: (
    next: SceneAppearancePreferences,
    previous: SceneAppearancePreferences | undefined
  ) => Promise<void>
  frameModel: () => Promise<void>
  resume: () => void
  dispose: () => void
}

/** `LocalWebGPUSceneView` reads this host; all model queries refer to this view's runtime. */
function createLocalPresentation({
  manager,
  sceneInfra,
  model,
  settings,
  selection,
}: PresentationContext): PresentationAdapter {
  sceneInfra.camControls.localCameraMode = true
  sceneInfra.camControls.resetLocalCameraToDefaultView()
  let initialCameraFramePending = true
  return {
    localHost: {
      claimInitialCameraFrame: () => {
        const pending = initialCameraFramePending
        initialCameraFramePending = false
        return pending
      },
      executionEvents: model.events,
      executing: model.executing,
      sceneGeneration: computed(() => model.state.value.engineSceneGeneration),
      currentSceneGeneration: () => model.state.peek().engineSceneGeneration,
      selectionFilter: computed(() => [...selection.filter.value]),
      commands: manager,
      sceneInfra,
      settingsActor: settings.actor,
      artifacts: () => model.state.peek().artifactGraph,
      defaultPlanes: () => model.state.peek().defaultPlanes,
      hasErrors: () => model.failed.peek(),
      exportModel: model.exportModel,
    },
    video: undefined,
    // Local appearance is supplied as React props by `KclScene`.
    applyAppearance: async () => {},
    frameModel: async () => {},
    resume: () => {},
    dispose: () => {},
  }
}

/** Video sits below the Three.js canvas, which supplies camera input and sketch overlays in stream mode too. */
function createStreamedPresentation({
  element,
  connection,
  manager,
  sceneInfra,
  settings,
}: PresentationContext): PresentationAdapter | Error {
  sceneInfra.camControls.localCameraMode = false
  const video = document.createElement('video')
  video.autoplay = true
  video.muted = true
  video.playsInline = true
  video.className = styles.video
  if (streamVideoObjectFit(navigator.userAgent) === 'fill')
    video.classList.add(styles.safariVideo)
  element.prepend(video)
  const detachVideo = connection.attachVideo(video)
  if (isErr(detachVideo)) return detachVideo
  return {
    localHost: undefined,
    video,
    applyAppearance: async (next, previous) => {
      if (previous?.theme !== next.theme) await manager.setTheme(next.theme)
      if (previous?.viewportRendering !== next.viewportRendering)
        manager.setViewportRendering(next.viewportRendering)
    },
    frameModel: () =>
      resetCameraPosition({ sceneInfra, settingsActor: settings.actor }),
    resume: () => {
      void video.play().catch(reportRejection)
    },
    dispose: detachVideo,
  }
}

/** Viewport operations retained by `openKclScene` until its resource is disposed. */
export interface SceneViewport {
  localHost: LocalRendererHost | undefined
  video: HTMLVideoElement | undefined
  resize: (size: { width: number; height: number }) => Promise<void>
  applySettings: () => Promise<void>
  frameModel: () => Promise<void>
  resume: () => void
  dispose: () => void
}

/** Attach one presentation and expose viewport operations; `openKclScene` still owns native, connection, and Three.js disposal. */
export function createSceneViewport(
  context: PresentationContext,
  presentation: ScenePresentation,
  preferences: ScenePresentationPreferences,
  isClosed: () => boolean
): SceneViewport | Error {
  const { element, sceneInfra, connection } = context
  const camera = sceneInfra.camControls
  sceneInfra.renderer.domElement.classList.add(styles.canvas)
  element.append(
    sceneInfra.renderer.domElement,
    sceneInfra.labelRenderer.domElement
  )
  const adapter =
    presentation === 'local'
      ? createLocalPresentation(context)
      : createStreamedPresentation(context)
  if (isErr(adapter)) return adapter
  const stopDensity = observeViewportDensity(() => {
    if (isClosed()) return
    resizeSceneCanvas(sceneInfra)
  })
  // `KclSession` also applies preferences after execution. Retaining applied
  // values prevents a new model from resetting the user's camera.
  const applyCameraInput = createCameraInputApplier(camera)
  let appliedCamera: SceneCameraPreferences | undefined
  let appliedAppearance: SceneAppearancePreferences | undefined
  const applyOverlayTheme = () => {
    const appearance = preferences.appearance.peek()
    const previousTheme = sceneInfra.theme
    applySceneOverlayTheme(
      sceneInfra,
      appearance.theme,
      appearance.viewportRendering,
      presentation === 'local'
    )
    if (sceneInfra.theme !== previousTheme) sceneInfra.resumeRendering()
  }
  applyOverlayTheme()
  return {
    localHost: adapter.localHost,
    video: adapter.video,
    resize: async (size: { width: number; height: number }) => {
      if (isClosed() || size.width < 4 || size.height < 4) return
      resizeSceneCanvas(sceneInfra)
      await connection.resize(getDimensions(size.width, size.height))
    },
    applySettings: async () => {
      if (isClosed()) return
      applyOverlayTheme()
      const nextCamera = preferences.camera.peek()
      const nextAppearance = preferences.appearance.peek()
      if (appliedCamera?.enableTouchControls !== nextCamera.enableTouchControls)
        camera.enableTouchControls = nextCamera.enableTouchControls
      applyCameraInput(nextCamera)
      if (appliedCamera?.cameraProjection !== nextCamera.cameraProjection)
        await camera.setCameraProjection(nextCamera.cameraProjection)
      appliedCamera = nextCamera
      await adapter.applyAppearance(nextAppearance, appliedAppearance)
      appliedAppearance = nextAppearance
    },
    frameModel: async () => {
      if (!isClosed()) await adapter.frameModel()
    },
    resume: () => {
      if (!isClosed()) adapter.resume()
    },
    dispose: () => {
      stopDensity()
      adapter.dispose()
    },
  }
}
