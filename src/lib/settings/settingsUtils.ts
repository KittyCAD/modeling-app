import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import { NIL as uuidNIL, v4 } from 'uuid'

import {
  defaultAppSettings,
  defaultProjectSettings,
  parseAppSettings,
  parseProjectSettings,
  serializeConfiguration,
  serializeProjectConfiguration,
} from '@src/lang/wasm'
import {
  cameraSystemToMouseControl,
  mouseControlsToCameraSystem,
} from '@src/lib/cameraControls'
import { BROWSER_PROJECT_NAME } from '@src/lib/constants'
import {
  getInitialDefaultDir,
  readAppSettingsFile,
  readProjectSettingsFile,
  writeAppSettingsFile,
  writeProjectSettingsFile,
} from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import {
  createSettings,
  type Setting,
  type SettingsType,
} from '@src/lib/settings/initialSettings'
import type {
  SaveSettingsPayload,
  SettingsLevel,
} from '@src/lib/settings/settingsTypes'
import { appThemeToTheme } from '@src/lib/theme'
import { err } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsActorType } from '@src/machines/settingsMachine'

type OmitNull<T> = T extends null ? undefined : T
const toUndefinedIfNull = (a: any): OmitNull<any> =>
  a === null ? undefined : a

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
      onboardingStatus: configuration?.settings?.app?.onboarding_status,
      streamIdleMode: toUndefinedIfNull(
        configuration?.settings?.app?.stream_idle_mode
      ),
      allowOrbitInSketchMode:
        configuration?.settings?.app?.allow_orbit_in_sketch_mode,
      projectDirectory: configuration?.settings?.project?.directory,
      showDebugPanel: configuration?.settings?.app?.show_debug_panel,
    },
    modeling: {
      defaultUnit: configuration?.settings?.modeling?.base_unit,
      cameraProjection: configuration?.settings?.modeling?.camera_projection,
      cameraOrbit: configuration?.settings?.modeling?.camera_orbit,
      mouseControls: mouseControlsToCameraSystem(
        configuration?.settings?.modeling?.mouse_controls
      ),
      gizmoType: configuration?.settings?.modeling?.gizmo_type,
      enableTouchControls:
        configuration?.settings?.modeling?.enable_touch_controls,
      useNewSketchMode: configuration?.settings?.modeling?.use_new_sketch_mode,
      highlightEdges: configuration?.settings?.modeling?.highlight_edges,
      enableSSAO: configuration?.settings?.modeling?.enable_ssao,
      showScaleGrid: configuration?.settings?.modeling?.show_scale_grid,
      fixedSizeGrid: configuration?.settings?.modeling?.fixed_size_grid,
      snapToGrid: configuration?.settings?.modeling?.snap_to_grid,
      majorGridSpacing: configuration?.settings?.modeling?.major_grid_spacing,
      minorGridsPerMajor:
        configuration?.settings?.modeling?.minor_grids_per_major,
      snapsPerMinor: configuration?.settings?.modeling?.snaps_per_minor,
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

export function settingsPayloadToConfiguration(
  configuration: DeepPartial<SaveSettingsPayload>
): DeepPartial<Configuration> {
  return {
    settings: {
      app: {
        appearance: {
          theme: configuration?.app?.theme,
        },
        onboarding_status: configuration?.app?.onboardingStatus,
        stream_idle_mode: configuration?.app?.streamIdleMode,
        allow_orbit_in_sketch_mode: configuration?.app?.allowOrbitInSketchMode,
        show_debug_panel: configuration?.app?.showDebugPanel,
      },
      modeling: {
        base_unit: configuration?.modeling?.defaultUnit,
        camera_projection: configuration?.modeling?.cameraProjection,
        camera_orbit: configuration?.modeling?.cameraOrbit,
        mouse_controls: configuration?.modeling?.mouseControls
          ? cameraSystemToMouseControl(configuration?.modeling?.mouseControls)
          : undefined,
        gizmo_type: configuration?.modeling?.gizmoType,
        enable_touch_controls: configuration?.modeling?.enableTouchControls,
        use_new_sketch_mode: configuration?.modeling?.useNewSketchMode,
        highlight_edges: configuration?.modeling?.highlightEdges,
        enable_ssao: configuration?.modeling?.enableSSAO,
        show_scale_grid: configuration?.modeling?.showScaleGrid,
        fixed_size_grid: configuration?.modeling?.fixedSizeGrid,
        snap_to_grid: configuration?.modeling?.snapToGrid,
        major_grid_spacing: configuration?.modeling?.majorGridSpacing,
        minor_grids_per_major: configuration?.modeling?.minorGridsPerMajor,
        snaps_per_minor: configuration?.modeling?.snapsPerMinor,
      },
      text_editor: {
        text_wrapping: configuration?.textEditor?.textWrapping,
        blinking_cursor: configuration?.textEditor?.blinkingCursor,
      },
      project: {
        directory: configuration?.app?.projectDirectory,
        default_project_name: configuration?.projects?.defaultProjectName,
      },
      command_bar: {
        include_settings: configuration?.commandBar?.includeSettings,
      },
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
    return namedView && key in namedView
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
    meta: {
      id: configuration?.settings?.meta?.id,
    },
    app: {
      // do not read in `theme`, because it is blocked on the project level
      onboardingStatus: configuration?.settings?.app?.onboarding_status,
      allowOrbitInSketchMode:
        configuration?.settings?.app?.allow_orbit_in_sketch_mode,
      namedViews: deepPartialNamedViewsToNamedViews(
        configuration?.settings?.app?.named_views
      ),
      showDebugPanel:
        configuration?.settings?.app?.show_debug_panel ?? undefined,
    },
    modeling: {
      defaultUnit: configuration?.settings?.modeling?.base_unit ?? undefined,
      highlightEdges: configuration?.settings?.modeling?.highlight_edges,
      enableSSAO: configuration?.settings?.modeling?.enable_ssao,
      fixedSizeGrid: toUndefinedIfNull(
        configuration?.settings?.modeling?.fixed_size_grid
      ),
      snapToGrid: toUndefinedIfNull(
        configuration?.settings?.modeling?.snap_to_grid
      ),
      majorGridSpacing: toUndefinedIfNull(
        configuration?.settings?.modeling?.major_grid_spacing
      ),
      minorGridsPerMajor: toUndefinedIfNull(
        configuration?.settings?.modeling?.minor_grids_per_major
      ),
      snapsPerMinor: toUndefinedIfNull(
        configuration?.settings?.modeling?.snaps_per_minor
      ),
    },
    textEditor: {
      textWrapping:
        configuration?.settings?.text_editor?.text_wrapping ?? undefined,
      blinkingCursor:
        configuration?.settings?.text_editor?.blinking_cursor ?? undefined,
    },
    commandBar: {
      includeSettings:
        configuration?.settings?.command_bar?.include_settings ?? undefined,
    },
  }
}

export function settingsPayloadToProjectConfiguration(
  configuration: DeepPartial<SaveSettingsPayload>
): DeepPartial<ProjectConfiguration> {
  return {
    settings: {
      meta: {
        id: configuration?.meta?.id,
      },
      app: {
        onboarding_status: configuration?.app?.onboardingStatus,
        allow_orbit_in_sketch_mode: configuration?.app?.allowOrbitInSketchMode,
        show_debug_panel: configuration?.app?.showDebugPanel,
        named_views: deepPartialNamedViewsToNamedViews(
          configuration?.app?.namedViews
        ),
      },
      modeling: {
        base_unit: configuration?.modeling?.defaultUnit,
        highlight_edges: configuration?.modeling?.highlightEdges,
        enable_ssao: configuration?.modeling?.enableSSAO,
        fixed_size_grid: configuration?.modeling?.fixedSizeGrid,
        snap_to_grid: configuration?.modeling?.snapToGrid,
        major_grid_spacing: configuration?.modeling?.majorGridSpacing,
        minor_grids_per_major: configuration?.modeling?.minorGridsPerMajor,
        snaps_per_minor: configuration?.modeling?.snapsPerMinor,
      },
      text_editor: {
        text_wrapping: configuration?.textEditor?.textWrapping,
        blinking_cursor: configuration?.textEditor?.blinkingCursor,
      },
      command_bar: {
        include_settings: configuration?.commandBar?.includeSettings,
      },
    },
  }
}

function localStorageAppSettingsPath() {
  return '/settings.toml'
}

function localStorageProjectSettingsPath() {
  return '/' + BROWSER_PROJECT_NAME + '/project.toml'
}

export function readLocalStorageAppSettingsFile(
  wasmInstance: ModuleType
): DeepPartial<Configuration> | Error {
  // TODO: Remove backwards compatibility after a few releases.
  let stored =
    localStorage.getItem(localStorageAppSettingsPath()) ??
    localStorage.getItem('/user.toml') ??
    ''

  if (stored === '') {
    return defaultAppSettings(wasmInstance)
  }

  try {
    return parseAppSettings(stored, wasmInstance)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    const settings = defaultAppSettings(wasmInstance)
    if (err(settings)) return settings
    const tomlStr = serializeConfiguration(settings)
    if (err(tomlStr)) return tomlStr

    localStorage.setItem(localStorageAppSettingsPath(), tomlStr)
    return settings
  }
}

export function readLocalStorageProjectSettingsFile(
  wasmInstance: ModuleType
): DeepPartial<ProjectConfiguration> | Error {
  // TODO: Remove backwards compatibility after a few releases.
  let stored = localStorage.getItem(localStorageProjectSettingsPath()) ?? ''

  if (stored === '') {
    return defaultProjectSettings(wasmInstance)
  }

  const projectSettings = parseProjectSettings(stored)
  if (err(projectSettings)) {
    const settings = defaultProjectSettings(wasmInstance)
    if (err(settings)) return settings
    const tomlStr = serializeProjectConfiguration(settings)
    if (err(tomlStr)) return tomlStr

    localStorage.setItem(localStorageProjectSettingsPath(), tomlStr)
    return settings
  } else {
    return projectSettings
  }
}

export interface AppSettings {
  settings: SettingsType
  configuration: DeepPartial<Configuration>
}

/**
 * Finds the TOML settings files for user-level (and project-level if projectPath is provided)
 * settings, deserialize them and validate them, serialize and write the validated TOML back to the locations,
 * and return the settings object and the raw "configuration" object returned from WASM.
 *
 * Relies on WASM for TOML de/serialization.
 */
export async function loadAndValidateSettings(
  initPromise: Promise<ModuleType> | ModuleType,
  projectPath?: string
): Promise<AppSettings> {
  // Make sure we have wasm initialized.
  const wasmInstance = await initPromise

  // Load the app settings from the file system or localStorage.
  const appSettingsPayload = window.electron
    ? await readAppSettingsFile(window.electron, wasmInstance)
    : readLocalStorageAppSettingsFile(wasmInstance)

  if (err(appSettingsPayload)) return Promise.reject(appSettingsPayload)

  let settingsNext = createSettings()

  // Because getting the default directory is async, we need to set it after
  if (isDesktop() && window.electron) {
    settingsNext.app.projectDirectory.default = await getInitialDefaultDir(
      window.electron
    )
  }

  settingsNext = setSettingsAtLevel(
    settingsNext,
    'user',
    configurationToSettingsPayload(appSettingsPayload)
  )

  // Load the project settings if they exist
  if (projectPath) {
    let projectSettings = window.electron
      ? await readProjectSettingsFile(window.electron, projectPath)
      : readLocalStorageProjectSettingsFile(wasmInstance)

    // An id was missing. Create one and write it to disk immediately.
    if (!err(projectSettings) && !projectSettings.settings?.meta?.id) {
      projectSettings = {
        settings: {
          meta: {
            id: v4(),
          },
        },
      }
      // Duplicated from settingsUtils.ts
      const projectTomlString = serializeProjectConfiguration(projectSettings)
      if (err(projectTomlString))
        return Promise.reject(new Error('Failed to serialize project settings'))
      if (window.electron) {
        await writeProjectSettingsFile(
          window.electron,
          projectPath,
          projectTomlString
        )
      } else {
        localStorage.setItem(
          localStorageProjectSettingsPath(),
          projectTomlString
        )
      }
    }

    if (err(projectSettings))
      return Promise.reject(new Error('Invalid project settings'))

    // An id was missing. Create one and write it to disk immediately.
    if (
      !projectSettings.settings?.meta?.id ||
      projectSettings.settings.meta.id === uuidNIL
    ) {
      const projectSettingsNew = {
        meta: {
          id: v4(),
        },
      }

      // Duplicated from settingsUtils.ts
      const projectTomlString = serializeProjectConfiguration(
        settingsPayloadToProjectConfiguration(projectSettingsNew)
      )
      if (err(projectTomlString))
        return Promise.reject(
          new Error('Could not serialize project configuration')
        )
      if (isDesktop() && window.electron) {
        await writeProjectSettingsFile(
          window.electron,
          projectPath,
          projectTomlString
        )
      } else {
        localStorage.setItem(
          localStorageProjectSettingsPath(),
          projectTomlString
        )
      }

      projectSettings = {
        settings: projectSettingsNew,
      }
    }

    // An id was missing. Create one and write it to disk immediately.
    if (
      !projectSettings.settings?.meta?.id ||
      projectSettings.settings.meta.id === uuidNIL
    ) {
      const projectSettingsParsed =
        projectConfigurationToSettingsPayload(projectSettings)
      const projectSettingsNew = {
        ...projectSettingsParsed,
        meta: {
          id: v4(),
        },
      }

      // Duplicated from settingsUtils.ts
      const projectTomlString = serializeProjectConfiguration(
        settingsPayloadToProjectConfiguration(projectSettingsNew)
      )

      if (err(projectTomlString))
        return Promise.reject(
          new Error('Could not serialize project configuration')
        )
      if (window.electron) {
        await writeProjectSettingsFile(
          window.electron,
          projectPath,
          projectTomlString
        )
      } else {
        localStorage.setItem(
          localStorageProjectSettingsPath(),
          projectTomlString
        )
      }

      projectSettings =
        settingsPayloadToProjectConfiguration(projectSettingsNew)
    }

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

/**
 * Given a settings object, serialize it to TOML
 * and write it to the appropriate location.
 *
 * Relies on WASM for TOML serialization.
 */
export async function saveSettings(
  initPromise: Promise<ModuleType>,
  allSettings: SettingsType,
  projectPath?: string
) {
  // Make sure we have wasm initialized.
  await initPromise

  // Get the user settings.
  const jsAppSettings = getChangedSettingsAtLevel(allSettings, 'user')
  const appTomlString = serializeConfiguration(
    settingsPayloadToConfiguration(jsAppSettings)
  )
  if (err(appTomlString)) return

  // Write the app settings.
  if (window.electron) {
    await writeAppSettingsFile(window.electron, appTomlString)
  } else {
    localStorage.setItem(localStorageAppSettingsPath(), appTomlString)
  }

  if (!projectPath) {
    // If we're not saving project settings, we're done.
    return
  }

  // Get the project settings.
  const jsProjectSettings = getChangedSettingsAtLevel(allSettings, 'project')
  const projectTomlString = serializeProjectConfiguration(
    settingsPayloadToProjectConfiguration(jsProjectSettings)
  )
  if (err(projectTomlString)) return

  // Write the project settings.
  if (window.electron) {
    await writeProjectSettingsFile(
      window.electron,
      projectPath,
      projectTomlString
    )
  } else {
    localStorage.setItem(localStorageProjectSettingsPath(), projectTomlString)
  }
}

export function getChangedSettingsAtLevel(
  allSettings: SettingsType,
  level: SettingsLevel
): Partial<SaveSettingsPayload> {
  const changedSettings = {} as Record<
    keyof SettingsType,
    Record<string, unknown>
  >
  Object.entries(allSettings).forEach(([category, settingsCategory]) => {
    const categoryKey = category as keyof SettingsType
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
  allSettings: SettingsType
): SaveSettingsPayload {
  const currentSettings = {} as SaveSettingsPayload
  Object.entries(allSettings).forEach(([category, settingsCategory]) => {
    const categoryKey = category as keyof SettingsType
    Object.entries(settingsCategory).forEach(
      ([setting, settingValue]: [string, Setting]) => {
        const settingKey = setting as keyof SettingsType[typeof categoryKey]
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
  allSettings: SettingsType,
  level: SettingsLevel
) {
  Object.entries(allSettings).forEach(([_category, settingsCategory]) => {
    Object.entries(settingsCategory).forEach(
      ([_, settingValue]: [string, Setting]) => {
        settingValue[level] = undefined
      }
    )
  })

  return allSettings
}

export function setSettingsAtLevel(
  allSettings: SettingsType,
  level: SettingsLevel,
  newSettings: Partial<SaveSettingsPayload>
) {
  Object.entries(newSettings).forEach(([category, settingsCategory]) => {
    const categoryKey = category as keyof SettingsType
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
      ['string', 'boolean', 'number'].some(
        (t) => typeof setting.default === t
      ) ||
      (setting.commandConfig?.inputType &&
        ['string', 'options', 'boolean', 'number'].some(
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
    return setting.commandConfig.inputType as
      | 'string'
      | 'options'
      | 'boolean'
      | 'number'
  return typeof setting.default as 'string' | 'boolean' | 'number'
}

export function getSettingsFromActorContext(
  s: SettingsActorType
): SettingsType {
  const {
    currentProject: _,
    commandBarActor: _cmd,
    ...settings
  } = s.getSnapshot().context
  return settings
}

export async function jsAppSettings(s: SettingsType | SettingsActorType) {
  const settings = 'send' in s ? getSettingsFromActorContext(s) : s
  return settingsPayloadToConfiguration(getAllCurrentSettings(settings))
}
