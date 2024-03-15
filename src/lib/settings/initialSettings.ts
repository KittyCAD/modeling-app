import { DEFAULT_PROJECT_NAME } from 'lib/constants'
import { Setting, SettingsMachineSchema } from 'lib/settings/settingsTypes'
import { SettingsMachineContext, UnitSystem } from 'lib/settings/settingsTypes'
import { Themes } from 'lib/theme'
import { resolveSetting } from './settingsUtils'

export const defaultSettings: SettingsMachineSchema = {
  baseUnit: 'mm',
  cameraControls: 'KittyCAD',
  defaultDirectory: '',
  defaultProjectName: DEFAULT_PROJECT_NAME,
  onboardingStatus: '',
  showDebugPanel: false,
  textWrapping: 'On',
  theme: Themes.System,
  unitSystem: UnitSystem.Metric,
}

export const initialSettings = Object.fromEntries(
  Object.entries(defaultSettings).map(([k, v]) => [
    k,
    {
      default: v,
      current() {
        return resolveSetting(this)
      },
    } satisfies Setting<typeof v>,
  ])
) as SettingsMachineContext
