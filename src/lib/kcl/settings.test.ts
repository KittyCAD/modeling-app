import { signal } from '@preact/signals-core'
import { createSettings } from '@src/lib/settings/initialSettings'
import {
  createKclSceneSettings,
  kclSceneCommands,
  KCL_GRID_OBJECT_ID,
  KCL_GRID_SCALE_TEXT_OBJECT_ID,
  type KclSceneSettings,
} from '@src/lib/kcl/settings'
import { darkModeMatcher, Themes } from '@src/lib/theme'
import { afterEach, expect, it, vi } from 'vitest'

const defaults: KclSceneSettings = {
  theme: Themes.Light,
  backfaceColor: '#123456',
  highlightEdges: false,
  showScaleGrid: false,
  fixedSizeGrid: true,
  defaultUnit: 'mm',
  cameraProjection: 'orthographic',
}
afterEach(() => vi.restoreAllMocks())

it('reads reactive user/project settings and follows the OS only for System theme', () => {
  const settings = createSettings()
  const source = signal(settings)
  const preferences = createKclSceneSettings(() => source.value)
  try {
    settings.app.theme.user = Themes.Dark
    settings.modeling.highlightEdges.user = false
    settings.modeling.showScaleGrid.user = false
    expect(preferences.current.value).toMatchObject({
      theme: Themes.Dark,
      highlightEdges: false,
      showScaleGrid: false,
    })
    settings.modeling.showScaleGrid.project = true
    expect(preferences.current.value.showScaleGrid).toBe(true)
    settings.modeling.showScaleGrid.project = undefined
    expect(preferences.current.value.showScaleGrid).toBe(false)
    if (darkModeMatcher) {
      const matches = vi
        .spyOn(darkModeMatcher, 'matches', 'get')
        .mockReturnValue(true)
      settings.app.theme.user = Themes.System
      darkModeMatcher.dispatchEvent(new Event('change'))
      expect(preferences.current.value.theme).toBe(Themes.Dark)
      matches.mockReturnValue(false)
      darkModeMatcher.dispatchEvent(new Event('change'))
      expect(preferences.current.value.theme).toBe(Themes.Light)
      settings.app.theme.user = Themes.Dark
      darkModeMatcher.dispatchEvent(new Event('change'))
      expect(preferences.current.value.theme).toBe(Themes.Dark)
    }
    const replacement = createSettings()
    replacement.app.theme.user = Themes.Light
    source.value = replacement
    expect(preferences.current.value.theme).toBe(Themes.Light)
  } finally {
    preferences.dispose()
  }
})

it('applies app colors, edge and grid visibility, scale and projection to a new scene', () => {
  const commands = kclSceneCommands(defaults)
  expect(commands).toEqual(
    expect.arrayContaining([
      {
        type: 'set_background_color',
        color: { r: 249 / 255, g: 249 / 255, b: 249 / 255, a: 1 },
      },
      expect.objectContaining({
        type: 'set_default_system_properties',
        backface_color: { r: 18 / 255, g: 52 / 255, b: 86 / 255, a: 1 },
      }),
      { type: 'edge_lines_visible', hidden: true },
      { type: 'object_visible', object_id: KCL_GRID_OBJECT_ID, hidden: true },
      {
        type: 'object_visible',
        object_id: KCL_GRID_SCALE_TEXT_OBJECT_ID,
        hidden: true,
      },
      { type: 'set_grid_scale', units: 'mm', value: 1 },
      { type: 'default_camera_set_orthographic' },
    ])
  )
})

it('restores graphics after KCL runs without resetting an unchanged camera projection', () => {
  expect(kclSceneCommands(defaults, defaults)).toEqual([])
  const commands = kclSceneCommands(defaults, defaults, true)
  expect(commands).toEqual(
    expect.arrayContaining([
      { type: 'edge_lines_visible', hidden: true },
      expect.objectContaining({ type: 'set_default_system_properties' }),
      { type: 'object_visible', object_id: KCL_GRID_OBJECT_ID, hidden: true },
    ])
  )
  expect(commands).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'default_camera_set_orthographic' }),
    ])
  )
  expect(
    kclSceneCommands({ ...defaults, fixedSizeGrid: false }, defaults)
  ).toEqual([{ type: 'set_grid_auto_scale' }])
})
