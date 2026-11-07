import type { ModelingCmd, UnitLength } from '@kittycad/viewer-sdk'
import { computed, signal } from '@preact/signals-core'
import {
  SYSTEM_HIGHLIGHT_COLOR,
  SYSTEM_SELECTION_COLOR,
} from '@src/lib/constants'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  darkModeMatcher,
  edgeColor,
  getOppositeTheme,
  getSystemTheme,
  getThemeColorForEngine,
  Themes,
  type ResolvedTheme,
} from '@src/lib/theme'
import { hexToRgba } from '@src/lib/utils'

/** Render preferences captured independently of the legacy modeling/editor singleton. */
export interface KclSceneSettings {
  theme: ResolvedTheme
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

/** Engine-reserved objects, shared with kcl-lib's engine::GRID_* constants. */
export const KCL_GRID_OBJECT_ID = 'cfa78409-653d-4c26-96f1-7c45fb784840'
export const KCL_GRID_SCALE_TEXT_OBJECT_ID =
  '10782f33-f588-4668-8bcd-040502d26590'

/** KCL reapplies its own graphics defaults, so force restores app preferences after a run. */
export function kclSceneCommands(
  next: KclSceneSettings,
  previous?: KclSceneSettings,
  force = false
): ModelingCmd[] | Error {
  const commands: ModelingCmd[] = []
  if (next.theme !== previous?.theme) {
    commands.push({
      type: 'set_background_color',
      color: getThemeColorForEngine(next.theme),
    })
  }
  if (
    force ||
    next.theme !== previous?.theme ||
    next.backfaceColor !== previous?.backfaceColor
  ) {
    const backfaceColor = hexToRgba(next.backfaceColor)
    if (!backfaceColor) return new Error('The backface color is invalid')
    commands.push({
      type: 'set_default_system_properties',
      color: getThemeColorForEngine(getOppositeTheme(next.theme)),
      backface_color: backfaceColor,
      edge_3d_color: edgeColor(),
      highlight_color: SYSTEM_HIGHLIGHT_COLOR,
      selection_color: SYSTEM_SELECTION_COLOR,
    })
  }
  if (force || next.highlightEdges !== previous?.highlightEdges) {
    commands.push({ type: 'edge_lines_visible', hidden: !next.highlightEdges })
  }
  if (force || next.showScaleGrid !== previous?.showScaleGrid) {
    commands.push(
      {
        type: 'object_visible',
        object_id: KCL_GRID_OBJECT_ID,
        hidden: !next.showScaleGrid,
      },
      {
        type: 'object_visible',
        object_id: KCL_GRID_SCALE_TEXT_OBJECT_ID,
        hidden: !next.showScaleGrid,
      }
    )
  }
  if (
    force ||
    next.fixedSizeGrid !== previous?.fixedSizeGrid ||
    next.defaultUnit !== previous?.defaultUnit
  ) {
    commands.push(
      next.fixedSizeGrid
        ? { type: 'set_grid_scale', units: next.defaultUnit, value: 1 }
        : { type: 'set_grid_auto_scale' }
    )
  }
  if (next.cameraProjection !== previous?.cameraProjection) {
    commands.push({
      type:
        next.cameraProjection === 'orthographic'
          ? 'default_camera_set_orthographic'
          : 'default_camera_set_perspective',
    })
  }
  return commands
}
