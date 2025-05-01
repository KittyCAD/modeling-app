import type { SaveSettingsPayload } from '@src/lib/settings/settingsTypes'
import { Themes } from '@src/lib/theme'
import type { DeepPartial } from '@src/lib/types'
import { onboardingPaths } from '@src/routes/Onboarding/paths'

import type { Settings } from '@rust/kcl-lib/bindings/Settings'

export const TEST_SETTINGS_KEY = '/settings.toml'
export const TEST_SETTINGS: DeepPartial<Settings> = {
  app: {
    appearance: {
      theme: Themes.Dark,
    },
    onboarding_status: 'dismissed',
    show_debug_panel: true,
  },
  modeling: {
    enable_ssao: false,
    base_unit: 'in',
    mouse_controls: 'zoo',
    camera_projection: 'perspective',
  },
  project: {
    default_project_name: 'untitled',
    directory: '',
  },
  text_editor: {
    text_wrapping: true,
  },
}

export const TEST_SETTINGS_ONBOARDING_USER_MENU: DeepPartial<Settings> = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboarding_status: onboardingPaths.USER_MENU },
}

export const TEST_SETTINGS_ONBOARDING_EXPORT: DeepPartial<Settings> = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboarding_status: onboardingPaths.EXPORT },
}

export const TEST_SETTINGS_ONBOARDING_PARAMETRIC_MODELING: DeepPartial<Settings> =
  {
    ...TEST_SETTINGS,
    app: {
      ...TEST_SETTINGS.app,
      onboarding_status: onboardingPaths.PARAMETRIC_MODELING,
    },
  }

export const TEST_SETTINGS_ONBOARDING_START: DeepPartial<Settings> = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboarding_status: '' },
}

export const TEST_SETTINGS_DEFAULT_THEME: DeepPartial<Settings> = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, appearance: { theme: Themes.System } },
}

export const TEST_SETTINGS_CORRUPTED = {
  app: {
    theme: Themes.Dark,
    onboardingStatus: 'dismissed',
    projectDirectory: 123 as any,
    showDebugPanel: true,
  },
  modeling: {
    defaultUnit: 'invalid' as any,
    mouseControls: `() => alert('hack the planet')` as any,
    cameraProjection: 'perspective',
  },
  projects: {
    defaultProjectName: false as any,
  },
  textEditor: {
    textWrapping: true,
  },
} satisfies Partial<SaveSettingsPayload>

export const TEST_CODE_GIZMO = `@settings(defaultLengthUnit = in)
part001 = startSketchOn(XZ)
|> startProfile(at = [20, 0])
|> line(end = [7.13, 4 + 0])
|> angledLine(angle = 3 + 0, length = 3.14 + 0 )
|> line(endAbsolute = [20.14 + 0, -0.14 + 0])
|> xLine(endAbsolute = 29 + 0)
|> yLine(length = -3.14 + 0, tag = $a)
|> xLine(length = 1.63)
|> angledLine(angle = 3 + 0, lengthX = 3.14 )
|> angledLine(angle = 30, lengthY = 3 + 0 )
|> angledLine(angle = 22.14 + 0, endAbsoluteX = 12)
|> angledLine(angle = 30, endAbsoluteY = 11.14)
|> angledLineThatIntersects(angle = 3.14, intersectTag = a, offset = 0)
|> tangentialArc(endAbsolute = [13.14 + 0, 13.14])
|> close()
|> extrude(length = 5 + 7)
`

export const TEST_CODE_LONG_WITH_ERROR_OUT_OF_VIEW = `width = 50.8
height = 30
thickness = 2
keychainHoleSize = 3

keychain = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [width, 0])
  |> line(endAbsolute = [width, height])
  |> line(endAbsolute = [0, height])
  |> close()
  |> extrude(length = thickness)

keychain1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [width, 0])
  |> line(endAbsolute = [width, height])
  |> line(endAbsolute = [0, height])
  |> close()
  |> extrude(length = thickness)

keychain2 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [width, 0])
  |> line(endAbsolute = [width, height])
  |> line(endAbsolute = [0, height])
  |> close()
  |> extrude(length = thickness)

box = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 10])
  |> line(end = [10, 0])
  |> line(end = [0, -10], tag = $revolveAxis)
  |> close()
  |> extrude(length = 10)

sketch001 = startSketchOn(box, face = revolveAxis)
  |> startProfile(at = [5, 10])
  |> line(end = [0, -10])
  |> line(end = [2, 0])
  |> line(end = [0, -10])
  |> close()
  |> revolve(
  axis = revolveAxis,
  angle = 90
  )

sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0.0, 0.0])
  |> xLine(length = 0.0)
  |> close()

`

export const TEST_CODE_TRIGGER_ENGINE_EXPORT_ERROR = `thing = 1`
