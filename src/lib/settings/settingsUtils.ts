import {
  getInitialDefaultDir,
  getSettingsFilePaths,
  readSettingsFile,
} from '../tauriFS'
import { Setting, createSettings, settings } from 'lib/settings/initialSettings'
import { SettingsLevel } from './settingsTypes'

export async function loadAndValidateSettings(projectPath?: string) {
  const settings = createSettings()
  settings.app.projectDirectory.default = await getInitialDefaultDir()
  // First, get the settings data at the user and project level
  const settingsFilePaths = await getSettingsFilePaths(projectPath)

  // Load the settings from the files
  if (settingsFilePaths.user) {
    const userSettings = await readSettingsFile(settingsFilePaths.user)
    if (userSettings) {
      setSettingsAtLevel(settings, 'user', userSettings)
    }
  }

  // Load the project settings if they exist
  if (settingsFilePaths.project) {
    const projectSettings = await readSettingsFile(settingsFilePaths.project)
    if (projectSettings) {
      setSettingsAtLevel(settings, 'project', projectSettings)
    }
  }

  // Return the settings object
  return settings
}

export function getChangedSettingsAtLevel(
  allSettings: typeof settings,
  level: SettingsLevel
) {
  const changedSettings = {} as Record<
    keyof typeof settings,
    Record<string, unknown>
  >
  Object.entries(allSettings).forEach(([category, settingsCategory]) => {
    const categoryKey = category as keyof typeof settings
    Object.entries(settingsCategory).forEach(
      ([setting, settingValue]: [string, Setting]) => {
        // If setting is different its ancestors' non-undefined values,
        // then it has been changed from the default
        if (
          settingValue[level] !== undefined &&
          ((level === 'project' &&
            (settingValue.user !== undefined
              ? settingValue.project !== settingValue.user
              : settingValue.project !== settingValue.default)) ||
            (level === 'user' && settingValue.user !== settingValue.default))
        ) {
          if (!changedSettings[categoryKey]) {
            changedSettings[categoryKey] = {}
          }
          changedSettings[categoryKey][setting] = settingValue[level]
        }
      }
    )
  })

  return changedSettings as typeof settings
}

export function setSettingsAtLevel(
  allSettings: typeof settings,
  level: SettingsLevel,
  newSettings: Partial<typeof settings>
) {
  Object.entries(newSettings).forEach(([category, settingsCategory]) => {
    const categoryKey = category as keyof typeof settings
    if (!allSettings[categoryKey]) return // ignore unrecognized categories
    Object.entries(settingsCategory).forEach(
      ([settingKey, settingValue]: [string, Setting]) => {
        // TODO: How do you get a valid type for allSettings[categoryKey][settingKey]?
        // it seems to always collapses to `never`, which is not correct
        // @ts-ignore
        if (!allSettings[categoryKey][settingKey]) return // ignore unrecognized settings
        // @ts-ignore
        allSettings[categoryKey][settingKey][level] = settingValue as unknown
      }
    )
  })

  return allSettings
}
