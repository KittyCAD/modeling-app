import type { PostEffectType, UnitLength } from '@kittycad/lib'
import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  getViewportPostEffect,
  type ViewportRendering,
} from '@src/lib/settings/viewportRendering'
import {
  darkModeMatcher,
  getSystemTheme,
  type ResolvedTheme,
  Themes,
} from '@src/lib/theme'

/** Values applied by `openKclScene` to its `SceneInfra.camControls`. */
export interface SceneCameraPreferences {
  mouseControls: SettingsType['modeling']['mouseControls']['current']
  enableTouchControls: boolean
  cameraProjection: 'perspective' | 'orthographic'
}

/** `theme` updates `SceneInfra.theme`; the streamed connection also receives the effective `viewportRendering` mode. */
export interface SceneAppearancePreferences {
  theme: ResolvedTheme
  viewportRendering: PostEffectType
}

/** Props read by `KclScene` when it renders `LocalWebGPUSceneView`. */
export interface LocalRendererPreferences {
  theme: ResolvedTheme
  enableSSAO: boolean
  viewportRendering: ViewportRendering
  backfaceColor: string
  highlightEdges: boolean
  fixedSizeGrid: boolean
}

/** `KclSession` observes `camera`/`appearance`; `KclScene` observes `localRenderer`. Shared inputs such as theme can update both consumers. */
export interface ScenePresentationPreferences {
  camera: ReadonlySignal<SceneCameraPreferences>
  appearance: ReadonlySignal<SceneAppearancePreferences>
  localRenderer: ReadonlySignal<LocalRendererPreferences>
  defaultUnit: ReadonlySignal<UnitLength>
  idleTimeout: ReadonlySignal<number | undefined>
}

/** Resolve user/project values and OS theme for presentation consumers. The KCL registry releases the OS listener through `dispose` when its executor closes. */
export function createScenePresentationPreferences(
  getSettings: () => SettingsType
) {
  const systemTheme = signal(getSystemTheme())
  const onSystemThemeChange = () => {
    systemTheme.value = getSystemTheme()
  }
  darkModeMatcher?.addEventListener('change', onSystemThemeChange)
  const theme = computed(() => {
    const choice = getSettings().app.theme.currentSignal.value
    return choice === Themes.System ? systemTheme.value : choice
  })
  const viewportRendering = computed(() => {
    const { modeling } = getSettings()
    return getViewportPostEffect(
      modeling.viewportRendering.currentSignal.value,
      modeling.enableSSAO.currentSignal.value
    )
  })
  const camera = computed<SceneCameraPreferences>(() => {
    const { modeling } = getSettings()
    return {
      mouseControls: modeling.mouseControls.currentSignal.value,
      enableTouchControls: modeling.enableTouchControls.currentSignal.value,
      cameraProjection: modeling.cameraProjection.currentSignal.value,
    }
  })
  const appearance = computed<SceneAppearancePreferences>(() => ({
    theme: theme.value,
    viewportRendering: viewportRendering.value,
  }))
  const localRenderer = computed<LocalRendererPreferences>(() => {
    const { modeling } = getSettings()
    return {
      theme: theme.value,
      enableSSAO: modeling.enableSSAO.currentSignal.value,
      viewportRendering: modeling.viewportRendering.currentSignal.value,
      backfaceColor: modeling.backfaceColor.currentSignal.value,
      highlightEdges: modeling.highlightEdges.currentSignal.value,
      fixedSizeGrid: modeling.fixedSizeGrid.currentSignal.value,
    }
  })
  return {
    camera,
    appearance,
    localRenderer,
    defaultUnit: computed(
      () => getSettings().modeling.defaultUnit.currentSignal.value
    ),
    idleTimeout: computed(
      () => getSettings().app.streamIdleMode.currentSignal.value
    ),
    dispose: () =>
      darkModeMatcher?.removeEventListener('change', onSystemThemeChange),
  }
}
