import { DEFAULT_PROJECT_NAME } from 'lib/constants'
import { SettingsMachineContext, UnitSystem } from 'lib/settings/settingsTypes'
import { Themes } from 'lib/theme'

export const initialSettings: SettingsMachineContext = {
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
