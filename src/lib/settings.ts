import { type Models } from '@kittycad/lib'
import { CameraSystem, cameraSystems } from './cameraControls'
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
const toggleAsArray = ['On', 'Off'] as const

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
  baseUnit: 'in' as BaseUnit,
  cameraControls: 'KittyCAD' as CameraSystem,
  defaultDirectory: '',
  defaultProjectName: DEFAULT_PROJECT_NAME,
  onboardingStatus: '',
  showDebugPanel: false,
  textWrapping: 'On' as Toggle,
  theme: Themes.System,
  unitSystem: UnitSystem.Imperial,
}

function isEnumMember<T extends Record<string, unknown>>(v: unknown, e: T) {
  return Object.values(e).includes(v)
}

const settingsValidators: Record<
  keyof SettingsMachineContext,
  (v: unknown) => boolean
> = {
  baseUnit: (v) => baseUnitsUnion.includes(v as BaseUnit),
  cameraControls: (v) => cameraSystems.includes(v as CameraSystem),
  defaultDirectory: (v) => typeof v === 'string',
  defaultProjectName: (v) => typeof v === 'string',
  onboardingStatus: (v) => typeof v === 'string',
  showDebugPanel: (v) => typeof v === 'boolean',
  textWrapping: (v) => toggleAsArray.includes(v as Toggle),
  theme: (v) => isEnumMember(v, Themes),
  unitSystem: (v) => isEnumMember(v, UnitSystem),
}

function removeInvalidSettingsKeys(s: Record<string, unknown>) {
  const validKeys = Object.keys(initialSettings)
  for (const key in s) {
    if (!validKeys.includes(key)) {
      console.warn(`Invalid key found in settings: ${key}`)
      delete s[key]
    }
  }
  return s
}

export function validateSettings(s: Record<string, unknown>) {
  let settingsNoInvalidKeys = removeInvalidSettingsKeys({ ...s })
  let errors: (keyof SettingsMachineContext)[] = []
  for (const key in settingsNoInvalidKeys) {
    const k = key as keyof SettingsMachineContext
    if (!settingsValidators[k](settingsNoInvalidKeys[k])) {
      delete settingsNoInvalidKeys[k]
      errors.push(k)
    }
  }

  return {
    settings: settingsNoInvalidKeys as Partial<SettingsMachineContext>,
    errors,
  }
}
