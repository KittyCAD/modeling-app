import type { PostEffectType, UnitLength } from '@kittycad/lib'
import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { getViewportPostEffect } from '@src/lib/settings/viewportRendering'
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

/** Theme and post-processing applied to `SceneInfra` and the streamed connection. */
export interface SceneAppearancePreferences {
  theme: ResolvedTheme
  viewportRendering: PostEffectType
}

/** Props read by `KclScene` when it renders `LocalWebGPUSceneView`. */
export interface LocalRendererPreferences {
  theme: ResolvedTheme
  enableSSAO: boolean
  backfaceColor: string
  highlightEdges: boolean
  fixedSizeGrid: boolean
}

/** Separate signals let local-renderer changes update React without reapplying camera or stream settings. */
export interface ScenePresentationPreferences {
  camera: ReadonlySignal<SceneCameraPreferences>
  appearance: ReadonlySignal<SceneAppearancePreferences>
  localRenderer: ReadonlySignal<LocalRendererPreferences>
  defaultUnit: ReadonlySignal<UnitLength>
}

/** Resolve the OS theme and effective user/project values for each presentation consumer. */
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
    dispose: () =>
      darkModeMatcher?.removeEventListener('change', onSystemThemeChange),
  }
}
