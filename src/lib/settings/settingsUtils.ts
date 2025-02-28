import {
  defaultAppSettings,
  defaultProjectSettings,
  initPromise,
  parseAppSettings,
  parseProjectSettings,
  serializeConfiguration,
  serializeProjectConfiguration,
} from 'lang/wasm'
import { mouseControlsToCameraSystem } from 'lib/cameraControls'
import { BROWSER_PROJECT_NAME } from 'lib/constants'
import {
  getInitialDefaultDir,
  readAppSettingsFile,
  readProjectSettingsFile,
  writeAppSettingsFile,
  writeProjectSettingsFile,
} from 'lib/desktop'
import { isDesktop } from 'lib/isDesktop'
import { Setting, createSettings, settings } from 'lib/settings/initialSettings'
import { appThemeToTheme } from 'lib/theme'
import { err } from 'lib/trap'
import { DeepPartial } from 'lib/types'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { NamedView } from 'wasm-lib/kcl/bindings/NamedView'
import { SaveSettingsPayload, SettingsLevel } from './settingsTypes'

/**
 * Convert from a rust settings struct into the JS settings struct.
 * We do this because the JS settings type has all the fancy shit
 * for hiding and showing settings.
 **/
export function configurationToSettingsPayload(
  configuration: DeepPartial<Configuration>
): DeepPartial<SaveSettingsPayload> {
  return {
    app: {
      theme: appThemeToTheme(configuration?.settings?.app?.appearance?.theme),
      themeColor: configuration?.settings?.app?.appearance?.color
        ? configuration?.settings?.app?.appearance?.color.toString()
        : undefined,
      onboardingStatus: configuration?.settings?.app?.onboarding_status,
      dismissWebBanner: configuration?.settings?.app?.dismiss_web_banner,
      streamIdleMode: configuration?.settings?.app?.stream_idle_mode,
      allowOrbitInSketchMode:
        configuration?.settings?.app?.allow_orbit_in_sketch_mode,
      projectDirectory: configuration?.settings?.project?.directory,
      enableSSAO: configuration?.settings?.modeling?.enable_ssao,
    },
    modeling: {
      defaultUnit: configuration?.settings?.modeling?.base_unit,
      cameraProjection: configuration?.settings?.modeling?.camera_projection,
      cameraOrbit: configuration?.settings?.modeling?.camera_orbit,
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

export function isNamedView(
  namedView: DeepPartial<NamedView> | undefined
): namedView is NamedView {
  const namedViewKeys = [
    'name',
    'eye_offset',
    'fov_y',
    'ortho_scale_enabled',
    'ortho_scale_factor',
    'pivot_position',
    'pivot_rotation',
    'world_coord_system',
    'version',
  ] as const

  return namedViewKeys.every((key) => {
    return namedView && namedView[key]
  })
}

function deepPartialNamedViewsToNamedViews(
  maybeViews: { [key: string]: NamedView | undefined } | undefined
): { [key: string]: NamedView } {
  const namedViews: { [key: string]: NamedView } = {}

  if (!maybeViews) {
    return namedViews
  }

  Object.entries(maybeViews)?.forEach(([key, maybeView]) => {
    if (isNamedView(maybeView)) {
      namedViews[key] = maybeView
    }
  })
  return namedViews
}

export function projectConfigurationToSettingsPayload(
  configuration: DeepPartial<ProjectConfiguration>
): DeepPartial<SaveSettingsPayload> {
  return {
    app: {
      // do not read in `theme`, because it is blocked on the project level
      themeColor: configuration?.settings?.app?.appearance?.color
        ? configuration?.settings?.app?.appearance?.color.toString()
        : undefined,
      onboardingStatus: configuration?.settings?.app?.onboarding_status,
      dismissWebBanner: configuration?.settings?.app?.dismiss_web_banner,
      streamIdleMode: configuration?.settings?.app?.stream_idle_mode,
      allowOrbitInSketchMode:
        configuration?.settings?.app?.allow_orbit_in_sketch_mode,
      enableSSAO: configuration?.settings?.modeling?.enable_ssao,
      namedViews: deepPartialNamedViewsToNamedViews(
        configuration?.settings?.app?.named_views
      ),
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

export function readLocalStorageAppSettingsFile():
  | DeepPartial<Configuration>
  | Error {
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
    const tomlStr = serializeConfiguration(settings)
    if (err(tomlStr)) return tomlStr

    localStorage.setItem(localStorageAppSettingsPath(), tomlStr)
    return settings
  }
}

function readLocalStorageProjectSettingsFile():
  | DeepPartial<ProjectConfiguration>
  | Error {
  // TODO: Remove backwards compatibility after a few releases.
  let stored = localStorage.getItem(localStorageProjectSettingsPath()) ?? ''

  if (stored === '') {
    return defaultProjectSettings()
  }

  const projectSettings = parseProjectSettings(stored)
  if (err(projectSettings)) {
    const settings = defaultProjectSettings()
    const tomlStr = serializeProjectConfiguration(settings)
    if (err(tomlStr)) return tomlStr

    localStorage.setItem(localStorageProjectSettingsPath(), tomlStr)
    return settings
  } else {
    return projectSettings
  }
}

export interface AppSettings {
  settings: ReturnType<typeof createSettings>
  configuration: DeepPartial<Configuration>
}

export async function loadAndValidateSettings(
  projectPath?: string
): Promise<AppSettings> {
  // Make sure we have wasm initialized.
  await initPromise

  const onDesktop = isDesktop()

  // Load the app settings from the file system or localStorage.
  const appSettingsPayload = onDesktop
    ? await readAppSettingsFile()
    : readLocalStorageAppSettingsFile()

  if (err(appSettingsPayload)) return Promise.reject(appSettingsPayload)

  let settingsNext = createSettings()

  // Because getting the default directory is async, we need to set it after
  if (onDesktop) {
    settings.app.projectDirectory.default = await getInitialDefaultDir()
  }

  settingsNext = setSettingsAtLevel(
    settingsNext,
    'user',
    configurationToSettingsPayload(appSettingsPayload)
  )

  // Load the project settings if they exist
  if (projectPath) {
    const projectSettings = onDesktop
      ? await readProjectSettingsFile(projectPath)
      : readLocalStorageProjectSettingsFile()

    if (err(projectSettings))
      return Promise.reject(new Error('Invalid project settings'))

    const projectSettingsPayload = projectSettings
    settingsNext = setSettingsAtLevel(
      settingsNext,
      'project',
      projectConfigurationToSettingsPayload(projectSettingsPayload)
    )
  }

  // Return the settings object
  return {
    settings: settingsNext,
    configuration: appSettingsPayload,
  }
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
  const appTomlString = serializeConfiguration({ settings: jsAppSettings })
  if (err(appTomlString)) return

  // Write the app settings.
  if (onDesktop) {
    await writeAppSettingsFile(appTomlString)
  } else {
    localStorage.setItem(localStorageAppSettingsPath(), appTomlString)
  }

  if (!projectPath) {
    // If we're not saving project settings, we're done.
    return
  }

  // Get the project settings.
  const jsProjectSettings = getChangedSettingsAtLevel(allSettings, 'project')
  console.log(allSettings, jsProjectSettings, 'nice')
  const projectTomlString = serializeProjectConfiguration({
    settings: jsProjectSettings,
  })
  if (err(projectTomlString)) return

  // Write the project settings.
  if (onDesktop) {
    await writeProjectSettingsFile(projectPath, projectTomlString)
  } else {
    localStorage.setItem(localStorageProjectSettingsPath(), projectTomlString)
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

export function getAllCurrentSettings(
  allSettings: typeof settings
): SaveSettingsPayload {
  const currentSettings = {} as SaveSettingsPayload
  Object.entries(allSettings).forEach(([category, settingsCategory]) => {
    const categoryKey = category as keyof typeof settings
    Object.entries(settingsCategory).forEach(
      ([setting, settingValue]: [string, Setting]) => {
        const settingKey =
          setting as keyof (typeof settings)[typeof categoryKey]
        currentSettings[categoryKey] = {
          ...currentSettings[categoryKey],
          [settingKey]: settingValue.current,
        }
      }
    )
  })

  return currentSettings
}

export function clearSettingsAtLevel(
  allSettings: typeof settings,
  level: SettingsLevel
) {
  Object.entries(allSettings).forEach(([category, settingsCategory]) => {
    const categoryKey = category as keyof typeof settings
    Object.entries(settingsCategory).forEach(
      ([_, settingValue]: [string, Setting]) => {
        settingValue[level] = undefined
      }
    )
  })

  return allSettings
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
