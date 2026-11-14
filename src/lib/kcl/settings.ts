import type { PostEffectType, UnitLength } from '@kittycad/lib'
import { computed, signal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { getViewportPostEffect } from '@src/lib/settings/viewportRendering'
import {
  darkModeMatcher,
  getSystemTheme,
  type ResolvedTheme,
  Themes,
} from '@src/lib/theme'

/** Render preferences captured independently of the legacy modeling/editor singleton. */
export interface KclSceneSettings {
  theme: ResolvedTheme
  enableSSAO: boolean
  viewportRendering: PostEffectType
  mouseControls: SettingsType['modeling']['mouseControls']['current']
  enableTouchControls: boolean
  backfaceColor: string
  highlightEdges: boolean
  showScaleGrid: boolean
  fixedSizeGrid: boolean
  defaultUnit: UnitLength
  cameraProjection: 'perspective' | 'orthographic'
}

/** Resolve System against the OS, and retain the settings service's user/project precedence. */
export function createKclSceneSettings(getSettings: () => SettingsType) {
  const systemTheme = signal(getSystemTheme())
  const onSystemThemeChange = () => {
    systemTheme.value = getSystemTheme()
  }
  darkModeMatcher?.addEventListener('change', onSystemThemeChange)
  const current = computed<KclSceneSettings>(() => {
    const { app, modeling } = getSettings()
    const theme = app.theme.currentSignal.value
    return {
      theme: theme === Themes.System ? systemTheme.value : theme,
      enableSSAO: modeling.enableSSAO.currentSignal.value,
      viewportRendering: getViewportPostEffect(
        modeling.viewportRendering.currentSignal.value,
        modeling.enableSSAO.currentSignal.value
      ),
      mouseControls: modeling.mouseControls.currentSignal.value,
      enableTouchControls: modeling.enableTouchControls.currentSignal.value,
      backfaceColor: modeling.backfaceColor.currentSignal.value,
      highlightEdges: modeling.highlightEdges.currentSignal.value,
      showScaleGrid: modeling.showScaleGrid.currentSignal.value,
      fixedSizeGrid: modeling.fixedSizeGrid.currentSignal.value,
      defaultUnit: modeling.defaultUnit.currentSignal.value,
      cameraProjection: modeling.cameraProjection.currentSignal.value,
    }
  })
  return {
    current,
    dispose: () =>
      darkModeMatcher?.removeEventListener('change', onSystemThemeChange),
  }
}
