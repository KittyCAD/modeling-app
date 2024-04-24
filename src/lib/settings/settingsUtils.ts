import {
  getInitialDefaultDir,
  getSettingsFilePaths,
  readSettingsFile,
} from '../tauriFS'
import { Setting, createSettings, settings } from 'lib/settings/initialSettings'
import { SaveSettingsPayload, SettingsLevel } from './settingsTypes'
import { isTauri } from 'lib/isTauri'
import { remove, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { initPromise, tomlParse, tomlStringify } from 'lang/wasm'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { mouseControlsToCameraSystem } from 'lib/cameraControls'
import { appThemeToTheme } from 'lib/theme'

/**
 * Convert from a rust settings struct into the JS settings struct.
 * We do this because the JS settings type has all the fancy shit
 * for hiding and showing settings.
 **/
function configurationToSettingsPayload(
  configuration: Configuration
): Partial<SaveSettingsPayload> {
  return {
    app: {
      theme: appThemeToTheme(configuration.settings.app.appearance.theme),
      themeColor: configuration.settings.app.appearance.color.toString(),
      onboardingStatus: configuration.settings.app.onboarding_status,
      dismissWebBanner: configuration.settings.app.dismiss_web_banner,
      projectDirectory: configuration.settings.project.directory,
    },
    modeling: {
      defaultUnit: configuration.settings.modeling.base_unit,
      mouseControls: mouseControlsToCameraSystem(
        configuration.settings.modeling.mouse_controls
      ),
      highlightEdges: configuration.settings.modeling.highlight_edges,
      showDebugPanel: configuration.settings.modeling.show_debug_panel,
    },
    textEditor: {
      textWrapping: configuration.settings.text_editor.text_wrapping,
      blinkingCursor: configuration.settings.text_editor.blinking_cursor,
    },
    projects: {
      defaultProjectName: configuration.settings.project.default_project_name,
    },
    commandBar: {
      includeSettings: configuration.settings.command_bar.include_settings,
    },
  }
}

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
    : (tomlParse(localStorage.getItem(path) ?? '')
        .settings as Partial<SaveSettingsPayload>)
}

export async function loadAndValidateSettings(projectPath?: string) {
  const settings = createSettings()
  settings.app.projectDirectory.default = await getInitialDefaultDir()
  // First, get the settings data at the user and project level
  const settingsFilePaths = await getSettingsFilePaths(projectPath)

  // Load the settings from the files
  if (settingsFilePaths.user) {
    await initPromise
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
  await initPromise
  if (changedSettings && Object.keys(changedSettings).length) {
    if (isTauri()) {
      await writeTextFile(
        settingsFilePath,
        tomlStringify({ settings: changedSettings })
      )
    }
    localStorage.setItem(
      settingsFilePath,
      tomlStringify({ settings: changedSettings })
    )
  } else {
    if (isTauri() && (await exists(settingsFilePath))) {
      await remove(settingsFilePath)
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
    Object.entries(settingsCategory).forEach(([settingKey, settingValue]) => {
      // TODO: How do you get a valid type for allSettings[categoryKey][settingKey]?
      // it seems to always collapses to `never`, which is not correct
      // @ts-ignore
      if (!allSettings[categoryKey][settingKey]) return // ignore unrecognized settings
      // @ts-ignore
      allSettings[categoryKey][settingKey][level] = settingValue as unknown
    })
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
    setting.hideOnPlatform === 'both' ||
    (setting.hideOnPlatform && isTauri()
      ? setting.hideOnPlatform === 'desktop'
      : setting.hideOnPlatform === 'web')
  )
}

/**
 * Returns true if the setting meets the requirements
 * to appear in the settings modal in this context
 * based on its config, the current settings level,
 * and the current platform
 */
export function shouldShowSettingInput(
  setting: Setting<unknown>,
  settingsLevel: SettingsLevel
) {
  return (
    !shouldHideSetting(setting, settingsLevel) &&
    (setting.Component ||
      ['string', 'boolean'].some((t) => typeof setting.default === t) ||
      (setting.commandConfig?.inputType &&
        ['string', 'options', 'boolean'].some(
          (t) => setting.commandConfig?.inputType === t
        )))
  )
}

/**
 * Get the appropriate input type to show given a
 * command's config. Highly dependent on the filtering logic from
 * shouldShowSettingInput being applied
 */
export function getSettingInputType(setting: Setting) {
  if (setting.Component) return 'component'
  if (setting.commandConfig)
    return setting.commandConfig.inputType as 'string' | 'options' | 'boolean'
  return typeof setting.default as 'string' | 'boolean'
}
