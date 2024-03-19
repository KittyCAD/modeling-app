import { type Models } from '@kittycad/lib'
import { type CameraSystem } from '../cameraControls'
import { Themes } from 'lib/theme'

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
export const toggleAsArray = ['On', 'Off'] as const

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
