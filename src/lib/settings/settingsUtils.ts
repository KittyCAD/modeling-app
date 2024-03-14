import { type CameraSystem, cameraSystems } from '../cameraControls'
import { Themes } from '../theme'
import { isTauri } from '../isTauri'
import { getInitialDefaultDir, readSettingsFile } from '../tauriFS'
import { initialSettings } from 'lib/settings/initialSettings'
import {
  type BaseUnit,
  baseUnitsUnion,
  type Toggle,
  type SettingsMachineContext,
  toggleAsArray,
  UnitSystem,
} from './settingsTypes'
import { SETTINGS_PERSIST_KEY } from '../constants'

export const fallbackLoadedSettings = {
  settings: initialSettings,
  errors: [] as (keyof SettingsMachineContext)[],
}

function isEnumMember<T extends Record<string, unknown>>(v: unknown, e: T) {
  return Object.values(e).includes(v)
}

export async function loadAndValidateSettings(): Promise<
  ReturnType<typeof validateSettings>
> {
  const fsSettings = isTauri() ? await readSettingsFile() : {}
  const localStorageSettings = JSON.parse(
    localStorage?.getItem(SETTINGS_PERSIST_KEY) || '{}'
  )
  const mergedSettings = Object.assign({}, localStorageSettings, fsSettings)

  return await validateSettings(mergedSettings)
}

const settingsValidators: Record<
  keyof SettingsMachineContext,
  (v: unknown) => boolean
> = {
  baseUnit: (v) => baseUnitsUnion.includes(v as BaseUnit),
  cameraControls: (v) => cameraSystems.includes(v as CameraSystem),
  defaultDirectory: (v) => typeof v === 'string' && (v.length > 0 || !isTauri()),
  defaultProjectName: (v) => typeof v === 'string' && v.length > 0,
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

export async function validateSettings(s: Record<string, unknown>) {
  let settingsNoInvalidKeys = removeInvalidSettingsKeys({ ...s })
  let errors: (keyof SettingsMachineContext)[] = []
  for (const key in settingsNoInvalidKeys) {
    const k = key as keyof SettingsMachineContext
    if (!settingsValidators[k](settingsNoInvalidKeys[k])) {
      delete settingsNoInvalidKeys[k]
      errors.push(k)
    }
  }

  // Here's our chance to insert the fallback defaultDir
  const defaultDirectory = isTauri() ? await getInitialDefaultDir() : ''

  const settings = Object.assign(
    initialSettings,
    { defaultDirectory },
    settingsNoInvalidKeys
  ) as SettingsMachineContext

  return {
    settings,
    errors,
  }
}
