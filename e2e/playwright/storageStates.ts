import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
import { Themes } from 'lib/theme'
import { onboardingPaths } from 'routes/Onboarding/paths'

export const IS_PLAYWRIGHT_KEY = 'playwright'

export const TEST_SETTINGS_KEY = '/settings.toml'
export const TEST_SETTINGS = {
  app: {
    theme: Themes.Dark,
    onboardingStatus: 'dismissed',
    projectDirectory: '',
    enableSSAO: false,
  },
  modeling: {
    defaultUnit: 'in',
    mouseControls: 'KittyCAD',
    cameraProjection: 'perspective',
    showDebugPanel: true,
  },
  projects: {
    defaultProjectName: 'project-$nnn',
  },
  textEditor: {
    textWrapping: true,
  },
} satisfies Partial<SaveSettingsPayload>

export const TEST_SETTINGS_ONBOARDING_USER_MENU = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboardingStatus: onboardingPaths.USER_MENU },
} satisfies Partial<SaveSettingsPayload>

export const TEST_SETTINGS_ONBOARDING_EXPORT = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboardingStatus: onboardingPaths.EXPORT },
} satisfies Partial<SaveSettingsPayload>

export const TEST_SETTINGS_ONBOARDING_PARAMETRIC_MODELING = {
  ...TEST_SETTINGS,
  app: {
    ...TEST_SETTINGS.app,
    onboardingStatus: onboardingPaths.PARAMETRIC_MODELING,
  },
} satisfies Partial<SaveSettingsPayload>

export const TEST_SETTINGS_ONBOARDING_START = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboardingStatus: '' },
} satisfies Partial<SaveSettingsPayload>

export const TEST_SETTINGS_DEFAULT_THEME = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, theme: Themes.System },
} satisfies Partial<SaveSettingsPayload>

export const TEST_SETTINGS_CORRUPTED = {
  app: {
    theme: Themes.Dark,
    onboardingStatus: 'dismissed',
    projectDirectory: 123 as any,
  },
  modeling: {
    defaultUnit: 'invalid' as any,
    mouseControls: `() => alert('hack the planet')` as any,
    cameraProjection: 'perspective',
    showDebugPanel: true,
  },
  projects: {
    defaultProjectName: false as any,
  },
  textEditor: {
    textWrapping: true,
  },
} satisfies Partial<SaveSettingsPayload>

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

// generated from  /home/paultag/Downloads/zma-logomark.svg
fn svg = (surface, origin, depth) => {
  let a0 = surface |> startProfileAt([origin[0] + 45.430427, origin[1] + -14.627736], %)
    |> bezierCurve({
    control1: [ 0, 0.764157 ],
    control2: [ 0, 1.528314 ],
    to: [ 0, 2.292469 ]
   }, %)
    |> bezierCurve({
    control1: [ -3.03202, 0 ],
    control2: [ -6.064039, 0 ],
    to: [ -9.09606, 0 ]
   }, %)
    |> bezierCurve({
    control1: [ 0, -1.077657 ],
    control2: [ 0, -2.155312 ],
    to: [ 0, -3.232969 ]
   }, %)
    |> bezierCurve({
    control1: [ 2.741805, 0 ],
    control2: [ 5.483613, 0 ],
    to: [ 8.225417, 0 ]
   }, %)
    |> bezierCurve({
    control1: [ -2.740682, -2.961815 ],
    control2: [ -5.490342, -5.925794 ],
    to: [ -8.225417, -8.886255 ]
   }, %)
    |> bezierCurve({
    control1: [ 0, -0.723995 ],
    control2: [ 0, -1.447988 ],
    to: [ 0, -2.171981 ]
   }, %)
    |> bezierCurve({
    control1: [ 0.712124, 0.05061 ],
    control2: [ 1.511636, -0.09877 ],
    to: [ 2.172096, 0.07005 ]
   }, %)
    |> bezierCurve({
    control1: [ 0.68573, 0.740811 ],
    control2: [ 1.371459, 1.481622 ],
    to: [ 2.057187, 2.222436 ]
   }, %)
    |> bezierCurve({
    control1: [ 0, -0.76416 ],
    control2: [ 0, -1.52832 ],
    to: [ 0, -2.29248 ]
   }, %)
    |> bezierCurve({
    control1: [ 3.032013, 0 ],
    control2: [ 6.064026, 0 ],
    to: [ 9.096038, 0 ]
   }, %)
    |> bezierCurve({
    control1: [ 0, 1.077657 ],
    control2: [ 0, 2.155314 ],
    to: [ 0, 3.232973 ]
   }, %)
    |> bezierCurve({
    control1: [ -2.741312, 0 ],
    control2: [ -5.482623, 0 ],
    to: [ -8.223936, 0 ]
   }, %)
    |> bezierCurve({
    control1: [ 2.741313, 2.961108 ],
    control2: [ 5.482624, 5.922216 ],
    to: [ 8.223936, 8.883325 ]
   }, %)
    |> bezierCurve({
    control1: [ 0, 0.724968 ],
    control2: [ 0, 1.449938 ],
    to: [ 0, 2.174907 ]
   }, %)
    |> bezierCurve({
    control1: [ -0.712656, -0.05145 ],
    control2: [ -1.512554, 0.09643 ],
    to: [ -2.173592, -0.07298 ]
   }, %)
    |> bezierCurve({
    control1: [ -0.685222, -0.739834 ],
    control2: [ -1.370445, -1.479669 ],
    to: [ -2.055669, -2.219505 ]
   }, %)
    |> close(%)
    |> extrude(depth, %)

  let a1 = surface |> startProfileAt([origin[0] + 57.920488, origin[1] + -15.244943], %)
    |> bezierCurve({
    control1: [ -2.78904, 0.106635 ],
    control2: [ -5.052548, -2.969529 ],
    to: [ -4.055141, -5.598369 ]
   }, %)
    |> bezierCurve({
    control1: [ 0.841523, -0.918736 ],
    control2: [ 0.439412, -1.541892 ],
    to: [ -0.368488, -2.214378 ]
   }, %)
    |> bezierCurve({
    control1: [ -0.418245, -0.448461 ],
    control2: [ -0.836489, -0.896922 ],
    to: [ -1.254732, -1.345384 ]
   }, %)
    |> bezierCurve({
    control1: [ -2.76806, 2.995359 ],
    control2: [ -2.32667, 8.18409 ],
    to: [ 0.897655, 10.678932 ]
   }, %)
    |> bezierCurve({
    control1: [ 2.562822, 2.186098 ],
    control2: [ 6.605111, 2.28043 ],
    to: [ 9.271202, 0.226476 ]
   }, %)
    |> bezierCurve({
    control1: [ -0.743744, -0.797465 ],
    control2: [ -1.487487, -1.594932 ],
    to: [ -2.231232, -2.392397 ]
   }, %)
    |> bezierCurve({
    control1: [ -0.672938, 0.421422 ],
    control2: [ -1.465362, 0.646946 ],
    to: [ -2.259264, 0.64512 ]
   }, %)
    |> close(%)
    |> extrude(depth, %)

  let a2 = surface |> startProfileAt([origin[0] + 62.19406300000001, origin[1] + -19.500698999999997], %)
    |> bezierCurve({
    control1: [ 0.302938, 1.281141 ],
    control2: [ -1.53575, 2.434288 ],
    to: [ -0.10908, 3.279477 ]
   }, %)
    |> bezierCurve({
    control1: [ 0.504637, 0.54145 ],
    control2: [ 1.009273, 1.082899 ],
    to: [ 1.513909, 1.624348 ]
   }, %)
    |> bezierCurve({
    control1: [ 2.767778, -2.995425 ],
    control2: [ 2.327135, -8.184384 ],
    to: [ -0.897661, -10.679047 ]
   }, %)
    |> bezierCurve({
    control1: [ -2.562947, -2.186022 ],
    control2: [ -6.604089, -2.279606 ],
    to: [ -9.271196, -0.227813 ]
   }, %)
    |> bezierCurve({
    control1: [ 0.744231, 0.797952 ],
    control2: [ 1.488461, 1.595904 ],
    to: [ 2.232692, 2.393856 ]
   }, %)
    |> bezierCurve({
    control1: [ 2.302377, -1.564629 ],
    control2: [ 5.793126, -0.15358 ],
    to: [ 6.396577, 2.547372 ]
   }, %)
    |> bezierCurve({
    control1: [ 0.08981, 0.346302 ],
    control2: [ 0.134865, 0.704078 ],
    to: [ 0.13476, 1.061807 ]
   }, %)
    |> close(%)
    |> extrude(depth, %)

  let a3 = surface |> startProfileAt([origin[0] + 74.124866, origin[1] + -15.244943], %)
    |> bezierCurve({
    control1: [ -2.78904, 0.106635 ],
    control2: [ -5.052549, -2.969529 ],
    to: [ -4.055142, -5.598369 ]
   }, %)
    |> bezierCurve({
    control1: [ 0.841527, -0.918738 ],
    control2: [ 0.43941, -1.541892 ],
    to: [ -0.368497, -2.214367 ]
   }, %)
    |> bezierCurve({
    control1: [ -0.418254, -0.448466 ],
    control2: [ -0.836507, -0.896931 ],
    to: [ -1.254761, -1.345395 ]
   }, %)
    |> bezierCurve({
    control1: [ -2.768019, 2.995371 ],
    control2: [ -2.326624, 8.184088 ],
    to: [ 0.897678, 10.678932 ]
   }, %)
    |> bezierCurve({
    control1: [ 2.56289, 2.186191 ],
    control2: [ 6.60516, 2.280307 ],
    to: [ 9.271371, 0.226476 ]
   }, %)
    |> bezierCurve({
    control1: [ -0.743808, -0.797465 ],
    control2: [ -1.487616, -1.594932 ],
    to: [ -2.231424, -2.392397 ]
   }, %)
    |> bezierCurve({
    control1: [ -0.672916, 0.421433 ],
    control2: [ -1.465344, 0.646926 ],
    to: [ -2.259225, 0.64512 ]
   }, %)
    |> close(%)
    |> extrude(depth, %)

  let a4 = surface |> startProfileAt([origin[0] + 77.57333899999998, origin[1] + -16.989262999999998], %)
    |> bezierCurve({
    control1: [ 0.743298, 0.797463 ],
    control2: [ 1.486592, 1.594926 ],
    to: [ 2.229888, 2.392389 ]
   }, %)
    |> bezierCurve({
    control1: [ 2.767827, -2.995393 ],
    control2: [ 2.327103, -8.184396 ],
    to: [ -0.897672, -10.679047 ]
   }, %)
    |> bezierCurve({
    control1: [ -2.562939, -2.186037 ],
    control2: [ -6.604077, -2.279589 ],
    to: [ -9.271185, -0.227813 ]
   }, %)
    |> bezierCurve({
    control1: [ 0.744243, 0.797952 ],
    control2: [ 1.488486, 1.595904 ],
    to: [ 2.232729, 2.393856 ]
   }, %)
    |> bezierCurve({
    control1: [ 2.302394, -1.564623 ],
    control2: [ 5.793201, -0.153598 ],
    to: [ 6.396692, 2.547372 ]
   }, %)
    |> bezierCurve({
    control1: [ 0.32074, 1.215468 ],
    control2: [ 0.06159, 2.564765 ],
    to: [ -0.690452, 3.573243 ]
   }, %)
    |> close(%)
    |> extrude(depth, %)

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
  return 0
}



svg(startSketchOn(keychain, 'end'), [-33, 32], -thickness)

startSketchOn(keychain, 'end')
  |> circle({ center: [
       width / 2,
       height - (keychainHoleSize + 1.5)
     ], radius: keychainHoleSize }, %)
  |> extrude(-thickness, %)`

export const TEST_CODE_TRIGGER_ENGINE_EXPORT_ERROR = `thing = 1`
