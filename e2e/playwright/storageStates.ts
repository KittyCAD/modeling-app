import { Themes } from 'lib/theme'
import { DeepPartial } from 'lib/types'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { Settings } from 'wasm-lib/kcl/bindings/Settings'

export const IS_PLAYWRIGHT_KEY = 'playwright'

export const TEST_SETTINGS_KEY = '/settings.toml'
export const TEST_SETTINGS = {
  app: {
    onboarding_status: 'dismissed',
    appearance: {
      theme: Themes.Dark,
    },
    show_debug_panel: true,
  },
  modeling: {
    base_unit: 'in',
    mouse_controls: 'zoo',
    camera_projection: 'perspective',
    enable_ssao: false,
  },
  project: {
    default_project_name: 'project-$nnn',
    directory: '',
  },
  text_editor: {
    text_wrapping: true,
  },
} satisfies DeepPartial<Settings>

export const TEST_SETTINGS_ONBOARDING_USER_MENU = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboarding_status: onboardingPaths.USER_MENU },
} satisfies DeepPartial<Settings>

export const TEST_SETTINGS_ONBOARDING_EXPORT = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboarding_status: onboardingPaths.EXPORT },
} satisfies DeepPartial<Settings>

export const TEST_SETTINGS_ONBOARDING_PARAMETRIC_MODELING = {
  ...TEST_SETTINGS,
  app: {
    ...TEST_SETTINGS.app,
    onboarding_status: onboardingPaths.PARAMETRIC_MODELING,
  },
} satisfies DeepPartial<Settings>

export const TEST_SETTINGS_ONBOARDING_START = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboarding_status: '' },
} satisfies DeepPartial<Settings>

export const TEST_SETTINGS_DEFAULT_THEME = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, appearance: { theme: Themes.System } },
} satisfies DeepPartial<Settings>

export const TEST_SETTINGS_CORRUPTED = {
  app: {
    onboarding_status: 'dismissed',
    appearance: {
      theme: Themes.Dark,
    },
    show_debug_panel: true,
  },
  modeling: {
    base_unit: 'invalid' as any,
    mouse_controls: `() => alert('hack the planet')` as any,
    camera_projection: 'perspective',
  },
  project: {
    default_project_name: false as any,
    directory: 123 as any,
  },
  text_editor: {
    text_wrapping: true,
  },
} satisfies DeepPartial<Settings>

export const TEST_CODE_GIZMO = `part001 = startSketchOn('XZ')
|> startProfileAt([20, 0], %)
|> line([7.13, 4 + 0], %)
|> angledLine({ angle: 3 + 0, length: 3.14 + 0 }, %)
|> lineTo([20.14 + 0, -0.14 + 0], %)
|> xLineTo(29 + 0, %)
|> yLine(-3.14 + 0, %, $a)
|> xLine(1.63, %)
|> angledLineOfXLength({ angle: 3 + 0, length: 3.14 }, %)
|> angledLineOfYLength({ angle: 30, length: 3 + 0 }, %)
|> angledLineToX({ angle: 22.14 + 0, to: 12 }, %)
|> angledLineToY({ angle: 30, to: 11.14 }, %)
|> angledLineThatIntersects({
  angle: 3.14,
  intersectTag: a,
  offset: 0
}, %)
|> tangentialArcTo([13.14 + 0, 13.14], %)
|> close(%)
|> extrude(5 + 7, %)
`

export const TEST_CODE_LONG_WITH_ERROR_OUT_OF_VIEW = `width = 50.8
height = 30
thickness = 2
keychainHoleSize = 3

keychain = startSketchOn("XY")
  |> startProfileAt([0, 0], %)
  |> lineTo([width, 0], %)
  |> lineTo([width, height], %)
  |> lineTo([0, height], %)
  |> close(%)
  |> extrude(thickness, %)

keychain1 = startSketchOn("XY")
  |> startProfileAt([0, 0], %)
  |> lineTo([width, 0], %)
  |> lineTo([width, height], %)
  |> lineTo([0, height], %)
  |> close(%)
  |> extrude(thickness, %)

keychain2 = startSketchOn("XY")
  |> startProfileAt([0, 0], %)
  |> lineTo([width, 0], %)
  |> lineTo([width, height], %)
  |> lineTo([0, height], %)
  |> close(%)
  |> extrude(thickness, %)

box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %, $revolveAxis)
  |> close(%)
  |> extrude(10, %)

sketch001 = startSketchOn(box, revolveAxis)
  |> startProfileAt([5, 10], %)
  |> line([0, -10], %)
  |> line([2, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> revolve({
  axis: revolveAxis,
  angle: 90
  }, %)

sketch001 = startSketchOn('XZ')
  |> startProfileAt([0.0, 0.0], %)
  |> xLine(0.0, %)
  |> close(%)

`

export const TEST_CODE_TRIGGER_ENGINE_EXPORT_ERROR = `thing = 1`
