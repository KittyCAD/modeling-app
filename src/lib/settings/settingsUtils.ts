import { Setting, createSettings, settings } from 'lib/settings/initialSettings'
import { SaveSettingsPayload, SettingsLevel } from './settingsTypes'
import { isDesktop } from 'lib/isDesktop'
import { err } from 'lib/trap'
import {
  defaultAppSettings,
  defaultProjectSettings,
  initPromise,
  parseAppSettings,
  parseProjectSettings,
  tomlStringify,
} from 'lang/wasm'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { mouseControlsToCameraSystem } from 'lib/cameraControls'
import { appThemeToTheme } from 'lib/theme'
import {
  readAppSettingsFile,
  readProjectSettingsFile,
  writeAppSettingsFile,
  writeProjectSettingsFile,
} from 'lib/desktop'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { BROWSER_PROJECT_NAME } from 'lib/constants'

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
      theme: appThemeToTheme(configuration?.settings?.app?.appearance?.theme),
      themeColor: configuration?.settings?.app?.appearance?.color
        ? configuration?.settings?.app?.appearance?.color.toString()
        : undefined,
      onboardingStatus: configuration?.settings?.app?.onboarding_status,
      dismissWebBanner: configuration?.settings?.app?.dismiss_web_banner,
      streamIdleMode: configuration?.settings?.app?.stream_idle_mode,
      projectDirectory: configuration?.settings?.project?.directory,
      enableSSAO: configuration?.settings?.modeling?.enable_ssao,
    },
    modeling: {
      defaultUnit: configuration?.settings?.modeling?.base_unit,
      mouseControls: mouseControlsToCameraSystem(
        configuration?.settings?.modeling?.mouse_controls
      ),
      highlightEdges: configuration?.settings?.modeling?.highlight_edges,
      showDebugPanel: configuration?.settings?.modeling?.show_debug_panel,
      showScaleGrid: configuration?.settings?.modeling?.show_scale_grid,
    },
    textEditor: {
      textWrapping: configuration?.settings?.text_editor?.text_wrapping,
      blinkingCursor: configuration?.settings?.text_editor?.blinking_cursor,
    },
    projects: {
      defaultProjectName:
        configuration?.settings?.project?.default_project_name,
    },
    commandBar: {
      includeSettings: configuration?.settings?.command_bar?.include_settings,
    },
  }
}

function projectConfigurationToSettingsPayload(
  configuration: ProjectConfiguration
): Partial<SaveSettingsPayload> {
  return {
    app: {
      theme: appThemeToTheme(configuration?.settings?.app?.appearance?.theme),
      themeColor: configuration?.settings?.app?.appearance?.color
        ? configuration?.settings?.app?.appearance?.color.toString()
        : undefined,
      onboardingStatus: configuration?.settings?.app?.onboarding_status,
      dismissWebBanner: configuration?.settings?.app?.dismiss_web_banner,
      streamIdleMode: configuration?.settings?.app?.stream_idle_mode,
      enableSSAO: configuration?.settings?.modeling?.enable_ssao,
    },
    modeling: {
      defaultUnit: configuration?.settings?.modeling?.base_unit,
      mouseControls: mouseControlsToCameraSystem(
        configuration?.settings?.modeling?.mouse_controls
      ),
      highlightEdges: configuration?.settings?.modeling?.highlight_edges,
      showDebugPanel: configuration?.settings?.modeling?.show_debug_panel,
    },
    textEditor: {
      textWrapping: configuration?.settings?.text_editor?.text_wrapping,
      blinkingCursor: configuration?.settings?.text_editor?.blinking_cursor,
    },
    commandBar: {
      includeSettings: configuration?.settings?.command_bar?.include_settings,
    },
  }
}

function localStorageAppSettingsPath() {
  return '/settings.toml'
}

function localStorageProjectSettingsPath() {
  return '/' + BROWSER_PROJECT_NAME + '/project.toml'
}

export function readLocalStorageAppSettingsFile(): Configuration | Error {
  // TODO: Remove backwards compatibility after a few releases.
  let stored =
    localStorage.getItem(localStorageAppSettingsPath()) ??
    localStorage.getItem('/user.toml') ??
    ''

  if (stored === '') {
    return defaultAppSettings()
  }

  try {
    return parseAppSettings(stored)
  } catch (e) {
    const settings = defaultAppSettings()
    if (err(settings)) return settings
    const tomlStr = tomlStringify(settings)
    if (err(tomlStr)) return tomlStr

    localStorage.setItem(localStorageAppSettingsPath(), tomlStr)
    return settings
  }
}

function readLocalStorageProjectSettingsFile(): ProjectConfiguration | Error {
  // TODO: Remove backwards compatibility after a few releases.
  let stored = localStorage.getItem(localStorageProjectSettingsPath()) ?? ''

  if (stored === '') {
    return defaultProjectSettings()
  }

  const projectSettings = parseProjectSettings(stored)
  if (err(projectSettings)) {
    const settings = defaultProjectSettings()
    const tomlStr = tomlStringify(settings)
    if (err(tomlStr)) return tomlStr

    localStorage.setItem(localStorageProjectSettingsPath(), tomlStr)
    return settings
  } else {
    return projectSettings
  }
}

export interface AppSettings {
  settings: ReturnType<typeof createSettings>
  configuration: Configuration
}

export async function loadAndValidateSettings(
  projectPath?: string
): Promise<AppSettings> {
  const settings = createSettings()
  const onDesktop = isDesktop()

  if (!onDesktop) {
    // Make sure we have wasm initialized.
    await initPromise
  }

  // Load the app settings from the file system or localStorage.
  const appSettings = onDesktop
    ? await readAppSettingsFile()
    : readLocalStorageAppSettingsFile()

  if (err(appSettings)) return Promise.reject(appSettings)

  // Convert the app settings to the JS settings format.
  const appSettingsPayload = configurationToSettingsPayload(appSettings)
  setSettingsAtLevel(settings, 'user', appSettingsPayload)

  // Load the project settings if they exist
  if (projectPath) {
    const projectSettings = onDesktop
      ? await readProjectSettingsFile(projectPath)
      : readLocalStorageProjectSettingsFile()

    if (err(projectSettings))
      return Promise.reject(new Error('Invalid project settings'))

    const projectSettingsPayload =
      projectConfigurationToSettingsPayload(projectSettings)
    setSettingsAtLevel(settings, 'project', projectSettingsPayload)
  }

  // Return the settings object
  return { settings, configuration: appSettings }
}

export async function saveSettings(
  allSettings: typeof settings,
  projectPath?: string
) {
  // Make sure we have wasm initialized.
  await initPromise
  const onDesktop = isDesktop()

  // Get the user settings.
  const jsAppSettings = getChangedSettingsAtLevel(allSettings, 'user')
  const tomlString = tomlStringify({ settings: jsAppSettings })
  if (err(tomlString)) return

  // Parse this as a Configuration.
  const appSettings = parseAppSettings(tomlString)
  if (err(appSettings)) return

  const tomlString2 = tomlStringify(appSettings)
  if (err(tomlString2)) return

  // Write the app settings.
  if (onDesktop) {
    await writeAppSettingsFile(appSettings)
  } else {
    localStorage.setItem(localStorageAppSettingsPath(), tomlString2)
  }

  if (!projectPath) {
    // If we're not saving project settings, we're done.
    return
  }

  // Get the project settings.
  const jsProjectSettings = getChangedSettingsAtLevel(allSettings, 'project')
  const projectTomlString = tomlStringify({ settings: jsProjectSettings })
  if (err(projectTomlString)) return

  // Parse this as a Configuration.
  const projectSettings = parseProjectSettings(projectTomlString)
  if (err(projectSettings)) return

  const tomlStr = tomlStringify(projectSettings)

  if (err(tomlStr)) return

  // Write the project settings.
  if (onDesktop) {
    await writeProjectSettingsFile(projectPath, projectSettings)
  } else {
    localStorage.setItem(localStorageProjectSettingsPath(), tomlStr)
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
    (setting.hideOnPlatform && isDesktop()
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
