import {
  getInitialDefaultDir,
  getSettingsFilePaths,
  readSettingsFile,
} from '../tauriFS'
import { Setting, createSettings, settings } from 'lib/settings/initialSettings'
import { SaveSettingsPayload, SettingsLevel } from './settingsTypes'
import { isTauri } from 'lib/isTauri'
import { removeFile, writeTextFile } from '@tauri-apps/api/fs'
import { exists } from 'tauri-plugin-fs-extra-api'
import * as TOML from '@iarna/toml'

/**
 * We expect the settings to be stored in a TOML file
 * or TOML-formatted string in localStorage
 * under a top-level [settings] key.
 * @param path
 * @returns
 */
function getSettingsFromStorage(path: string) {
  return isTauri()
    ? readSettingsFile(path)
    : (TOML.parse(localStorage.getItem(path) ?? '')
        .settings as Partial<SaveSettingsPayload>)
}

export async function loadAndValidateSettings(projectPath?: string) {
  const settings = createSettings()
  settings.app.projectDirectory.default = await getInitialDefaultDir()
  // First, get the settings data at the user and project level
  const settingsFilePaths = await getSettingsFilePaths(projectPath)

  // Load the settings from the files
  if (settingsFilePaths.user) {
    const userSettings = await getSettingsFromStorage(settingsFilePaths.user)
    if (userSettings) {
      setSettingsAtLevel(settings, 'user', userSettings)
    }
  }

  // Load the project settings if they exist
  if (settingsFilePaths.project) {
    const projectSettings = await getSettingsFromStorage(
      settingsFilePaths.project
    )
    if (projectSettings) {
      setSettingsAtLevel(settings, 'project', projectSettings)
    }
  }

  // Return the settings object
  return settings
}

export async function saveSettings(
  allSettings: typeof settings,
  projectPath?: string
) {
  const settingsFilePaths = await getSettingsFilePaths(projectPath)

  if (settingsFilePaths.user) {
    const changedSettings = getChangedSettingsAtLevel(allSettings, 'user')

    await writeOrClearPersistedSettings(settingsFilePaths.user, changedSettings)
  }

  if (settingsFilePaths.project) {
    const changedSettings = getChangedSettingsAtLevel(allSettings, 'project')

    await writeOrClearPersistedSettings(
      settingsFilePaths.project,
      changedSettings
    )
  }
}

async function writeOrClearPersistedSettings(
  settingsFilePath: string,
  changedSettings: Partial<SaveSettingsPayload>
) {
  if (changedSettings && Object.keys(changedSettings).length) {
    if (isTauri()) {
      await writeTextFile(
        settingsFilePath,
        TOML.stringify({ settings: changedSettings })
      )
    }
    localStorage.setItem(
      settingsFilePath,
      TOML.stringify({ settings: changedSettings })
    )
  } else {
    if (isTauri() && (await exists(settingsFilePath))) {
      await removeFile(settingsFilePath)
    }
    localStorage.removeItem(settingsFilePath)
  }
}

export function getChangedSettingsAtLevel(
  allSettings: typeof settings,
  level: SettingsLevel
): Partial<SaveSettingsPayload> {
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

  return changedSettings
}

export function setSettingsAtLevel(
  allSettings: typeof settings,
  level: SettingsLevel,
  newSettings: Partial<SaveSettingsPayload>
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

/**
 * Returns true if the setting should be hidden
 * based on its config, the current settings level,
 * and the current platform.
 */
export function shouldHideSetting(
  setting: Setting<unknown>,
  settingsLevel: SettingsLevel
) {
  return (
    setting.hideOnLevel === settingsLevel ||
    (setting.hideOnPlatform && isTauri()
      ? setting.hideOnPlatform === 'desktop'
      : setting.hideOnPlatform === 'web')
  )
}
