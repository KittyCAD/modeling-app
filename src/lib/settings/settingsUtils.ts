import { isTauri } from '../isTauri'
import {
  getInitialDefaultDir,
  getSettingsFilePaths,
  readSettingsFile,
} from '../tauriFS'
import { Setting, SettingsLevel, createSettings, settings } from 'lib/settings/initialSettings'
import { SETTINGS_PERSIST_KEY } from '../constants'


export function isEnumMember<T extends Record<string, unknown>>(
  v: unknown,
  e: T
) {
  return Object.values(e).includes(v)
}

export async function loadAndValidateSettings() {
  const settings = createSettings()
  settings.app.projectDirectory.default = await getInitialDefaultDir()
  console.log('initial settings object', settings)
  // First, get the settings data at the user and project level
  const settingsFilePaths = await getSettingsFilePaths()
  console.log('settingsFilePaths', settingsFilePaths)

  // Now, iterate through the found settings and use the setter function at the corresponding level
  // This will also validate the setting
  const fsUserSettings = isTauri() ? await readSettingsFile() : {}
  const fsUserSettingsTransformed = Object.fromEntries(
    Object.entries(fsUserSettings).map(([k, v]) => [
      k,
      {
        user: v,
      },
    ])
  )
  const localStorageSettings = JSON.parse(
    localStorage?.getItem(SETTINGS_PERSIST_KEY) || '{}'
  )

  console.log('loaded settings', {
    localStorageSettings,
    fsUserSettings,
    fsUserSettingsTransformed,
  })
  const mergedSettings = Object.assign({}, localStorageSettings, fsUserSettingsTransformed)

  // Return the settings object
  return settings
}

export function getChangedSettingsAtLevel(allSettings: typeof settings, level: SettingsLevel) {
  const changedSettings = {} as Record<keyof typeof settings, Record<string, unknown>>
  Object.entries(allSettings).forEach(([category, settingsCategory]) => {
    const categoryKey = category as keyof typeof settings
    Object.entries(settingsCategory).forEach(([setting, settingValue]: [string, Setting]) => {
      if (settingValue[level] !== settingValue.default && settingValue[level] !== undefined) {
        if (!changedSettings[categoryKey]) {
          changedSettings[categoryKey] = {}
        }
        changedSettings[categoryKey][setting] = settingValue[level]
      }
    })
  })

  return changedSettings as typeof settings
}