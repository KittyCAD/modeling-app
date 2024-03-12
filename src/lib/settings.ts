import { type Models } from '@kittycad/lib'
import { CameraSystem } from './cameraControls'
import { Themes } from './theme'

export const DEFAULT_PROJECT_NAME = 'project-$nnn'
export const SETTINGS_PERSIST_KEY = 'SETTINGS_PERSIST_KEY'
export const SETTINGS_FILE_NAME = 'settings.json'

export enum UnitSystem {
  Imperial = 'imperial',
  Metric = 'metric',
}

export const baseUnits = {
  imperial: ['in', 'ft', 'yd'],
  metric: ['mm', 'cm', 'm'],
} as const

export type BaseUnit = Models['UnitLength_type']

export const baseUnitsUnion = Object.values(baseUnits).flatMap((v) => v)

export type Toggle = 'On' | 'Off'

export type SettingsMachineContext = {
  baseUnit: BaseUnit
  cameraControls: CameraSystem
  defaultDirectory: string
  defaultProjectName: string
  onboardingStatus: string
  showDebugPanel: boolean
  textWrapping: Toggle
  theme: Themes
  unitSystem: UnitSystem
}

export const initialSettings: SettingsMachineContext = {
  baseUnit: 'mm' as BaseUnit,
  cameraControls: 'KittyCAD' as CameraSystem,
  defaultDirectory: '',
  defaultProjectName: DEFAULT_PROJECT_NAME,
  onboardingStatus: '',
  showDebugPanel: false,
  textWrapping: 'On' as Toggle,
  theme: Themes.System,
  unitSystem: UnitSystem.Metric,
}
