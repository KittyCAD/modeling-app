import { join } from 'node:path'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'

import {
  parseAppSettings,
  parseProjectSettings,
  serializeConfiguration,
  serializeProjectConfiguration,
} from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { defaultLayoutConfig } from '@src/lib/layout/configs/default'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { createLayoutWithMetadata } from '@src/lib/layout/utils'
import { getDefaultProjectLibrarySettings } from '@src/lib/projectLibraries'
import { projectLibrariesSettingsContribution } from '@src/lib/projectLibraries/settings/setting'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { createSettings, type Setting } from '@src/lib/settings/initialSettings'
import {
  configurationToSettingsPayload,
  formatSettingsLabel,
  getAllCurrentSettings,
  getChangedSettingsAtLevel,
  hiddenOnPlatform,
  mergeProjectConfiguration,
  projectConfigurationToSettingsPayload,
  replaceProjectSettingsPreservingMetadata,
  setSettingsAtLevel,
  settingsPayloadToConfiguration,
  settingsPayloadToProjectConfiguration,
} from '@src/lib/settings/settingsUtils'
import type { DeepPartial } from '@src/lib/types'
import { describe, expect, it } from 'vitest'

const pluginExtensionSettings = {
  plugins: {
    telemetry: defineBooleanExtensionSetting({
      defaultValue: true,
      description: 'Whether the telemetry plugin is enabled.',
      hideOnLevel: 'project',
      userToml: {
        sectionKey: 'plugins',
        tomlKey: 'telemetry',
      },
    }),
  },
}

const projectLibrariesExtensionSettings = projectLibrariesSettingsContribution

const createSettingsWithProjectLibraries = () =>
  createSettings(projectLibrariesExtensionSettings)

describe('testing settings initialization', () => {
  it(`sets settings at the 'user' level`, () => {
    const settings = createSettings()
    const appConfiguration: DeepPartial<Configuration> = {
      settings: {
        app: {
          appearance: {
            theme: 'dark',
          },
        },
      },
    }

    const appSettingsPayload = configurationToSettingsPayload(appConfiguration)

    setSettingsAtLevel(settings, 'user', appSettingsPayload)

    expect(settings.app.theme.current).toBe('dark')
  })

  it(`doesn't read theme from project settings`, () => {
    const settings = createSettings()
    const appConfiguration: DeepPartial<Configuration> = {
      settings: {
        app: {
          appearance: {
            theme: 'dark',
          },
        },
        modeling: {
          base_unit: 'cm',
        },
      },
    }
    const projectConfiguration: DeepPartial<ProjectConfiguration> = {
      settings: {
        app: {
          appearance: {
            theme: 'light',
          },
        },
        modeling: {
          base_unit: 'ft',
        },
      },
    }

    const appSettingsPayload = configurationToSettingsPayload(appConfiguration)
    const projectSettingsPayload =
      projectConfigurationToSettingsPayload(projectConfiguration)

    setSettingsAtLevel(settings, 'user', appSettingsPayload)
    setSettingsAtLevel(settings, 'project', projectSettingsPayload)

    // The 'project'-level for `theme` setting should be ignored completely
    expect(settings.app.theme.current).toBe('dark')
    // But the 'project'-level for `defaultUnit` setting should be applied
    expect(settings.modeling.defaultUnit.current).toBe('ft')
  })

  it('treats an empty project libraries setting as an explicit non-default value', () => {
    const settings = createSettingsWithProjectLibraries()
    settings.app.libraries.default =
      getDefaultProjectLibrarySettings('/tmp/projects')

    expect(settings.app.libraries.current).toEqual([
      {
        title: 'Default Projects Directory',
        path: '/tmp/projects',
        type: 'directory',
      },
    ])

    setSettingsAtLevel(settings, 'user', {
      app: {
        libraries: [],
      },
    })

    expect(settings.app.libraries.current).toEqual([])
    expect(getChangedSettingsAtLevel(settings, 'user').app?.libraries).toEqual(
      []
    )
  })
})

describe('testing getAllCurrentSettings', () => {
  it('returns the correct settings', () => {
    // Set up the settings
    const settings = createSettings()
    const appConfiguration: DeepPartial<Configuration> = {
      settings: {
        app: {
          appearance: {
            theme: 'dark',
          },
        },
        modeling: {
          base_unit: 'm',
        },
      },
    }
    const projectConfiguration: DeepPartial<ProjectConfiguration> = {
      settings: {
        modeling: {
          base_unit: 'ft',
        },
      },
    }

    const appSettingsPayload = configurationToSettingsPayload(appConfiguration)
    const projectSettingsPayload =
      projectConfigurationToSettingsPayload(projectConfiguration)

    setSettingsAtLevel(settings, 'user', appSettingsPayload)
    setSettingsAtLevel(settings, 'project', projectSettingsPayload)

    // Now the test: get all the settings' current resolved values
    const allCurrentSettings = getAllCurrentSettings(settings)
    // This one gets the 'user'-level theme because it's ignored at the project level
    // (see the test "doesn't read theme from project settings")
    expect(allCurrentSettings.app.theme).toBe('dark')
    expect(allCurrentSettings.modeling.defaultUnit).toBe('ft')
  })
})

describe('testing hiddenOnPlatform', () => {
  it('correctly identifies hidden settings on desktop', () => {
    const setting1 = { hideOnPlatform: 'both' } as Setting<unknown>
    const setting2 = { hideOnPlatform: 'desktop' } as Setting<unknown>
    const setting3 = { hideOnPlatform: 'web' } as Setting<unknown>
    const setting4 = { hideOnPlatform: undefined } as Setting<unknown>

    expect(hiddenOnPlatform(setting1, true)).toBe(true)
    expect(hiddenOnPlatform(setting2, true)).toBe(true)
    expect(hiddenOnPlatform(setting3, true)).toBe(false)
    expect(hiddenOnPlatform(setting4, true)).toBe(false)
  })

  it('correctly identifies hidden settings on web', () => {
    const setting1 = { hideOnPlatform: 'both' } as Setting
    const setting2 = { hideOnPlatform: 'desktop' } as Setting
    const setting3 = { hideOnPlatform: 'web' } as Setting
    const setting4 = { hideOnPlatform: undefined } as Setting

    expect(hiddenOnPlatform(setting1, false)).toBe(true)
    expect(hiddenOnPlatform(setting2, false)).toBe(false)
    expect(hiddenOnPlatform(setting3, false)).toBe(true)
    expect(hiddenOnPlatform(setting4, false)).toBe(false)
  })

  it('hides feature-gated settings unless the feature is enabled', () => {
    const setting = {
      hideWithoutFeature: OPFS_CLOUD_FEATURE_FLAG,
    } as Setting<unknown>

    expect(hiddenOnPlatform(setting, true)).toBe(true)
    expect(hiddenOnPlatform(setting, false, () => false)).toBe(true)
    expect(
      hiddenOnPlatform(
        setting,
        false,
        (feature) => feature === OPFS_CLOUD_FEATURE_FLAG
      )
    ).toBe(false)
  })

  it('can scope feature-gated settings to web', () => {
    const setting = {
      hideWithoutFeatureOnPlatform: {
        web: OPFS_CLOUD_FEATURE_FLAG,
      },
    } as Setting<unknown>

    expect(hiddenOnPlatform(setting, true)).toBe(false)
    expect(hiddenOnPlatform(setting, false, () => false)).toBe(true)
    expect(
      hiddenOnPlatform(
        setting,
        false,
        (feature) => feature === OPFS_CLOUD_FEATURE_FLAG
      )
    ).toBe(false)
  })

  it('keeps libraries visible on desktop and feature-gated on web', () => {
    const settings = createSettingsWithProjectLibraries()
    const libraries = settings.app.libraries as Setting

    expect(hiddenOnPlatform(libraries, true, () => false)).toBe(false)
    expect(hiddenOnPlatform(libraries, false, () => false)).toBe(true)
    expect(
      hiddenOnPlatform(
        libraries,
        false,
        (feature) => feature === OPFS_CLOUD_FEATURE_FLAG
      )
    ).toBe(false)
  })
})

// This tests if default project level settings can override non-default user level settings.
// Eg.:
// user.debug.showPanel = true
// project.debug.showPanel = false (the default is false)
// Then we expect debug.showPanel to resolve to false.
// We used to have a bug where this project level default value was not serialized,
// this regression test protects against that.

describe('project settings serialization regression', () => {
  it('preserves app-owned user settings through wasm round-trip', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    const serializedToml = serializeConfiguration(
      settingsPayloadToConfiguration(
        {
          app: {
            onboardingStatus: 'dismissed',
            allowOrbitInSketchMode: true,
            machineApi: true,
            showAllFiles: true,
            projectDirectory: '/tmp/projects',
            libraries: [
              {
                title: 'Default Projects Directory',
                path: '/tmp/projects',
                type: 'directory',
              },
            ],
          },
          debug: {
            showPanel: true,
            showModelingMachineState: true,
          },
          projects: {
            defaultProjectName: 'plugin-template',
          },
          modeling: {
            mouseControls: 'OnShape',
            gizmoType: 'axis',
            enableTouchControls: false,
            useSketchSolveMode: false,
            snapToGrid: true,
            majorGridSpacing: 2.5,
            minorGridsPerMajor: 5,
            snapsPerMinor: 3,
          },
          commandBar: {
            includeSettings: false,
          },
          textEditor: {
            textWrapping: false,
            blinkingCursor: false,
          },
          layout: {
            configs: {
              default: createLayoutWithMetadata(defaultLayoutConfig),
            },
          },
        },
        projectLibrariesExtensionSettings
      ),
      wasmInstance
    )
    if (serializedToml instanceof Error) {
      throw serializedToml
    }

    expect(serializedToml).toContain('onboarding_status = "dismissed"')
    expect(serializedToml).toContain('allow_orbit_in_sketch_mode = true')
    expect(serializedToml).toContain('machine_api = true')
    expect(serializedToml).toContain('show_all_files = true')
    expect(serializedToml).toContain('[[settings.app.libraries]]')
    expect(serializedToml).toContain('[settings.debug]')
    expect(serializedToml).toContain('show_panel = true')
    expect(serializedToml).toContain('show_modeling_machine_state = true')
    expect(serializedToml).toContain('mouse_controls = "onshape"')
    expect(serializedToml).toContain('gizmo_type = "axis"')
    expect(serializedToml).toContain('enable_touch_controls = false')
    expect(serializedToml).toContain('use_sketch_solve_mode = false')
    expect(serializedToml).toContain('snap_to_grid = true')
    expect(serializedToml).toContain('major_grid_spacing = 2.5')
    expect(serializedToml).toContain('minor_grids_per_major = 5')
    expect(serializedToml).toContain('snaps_per_minor = 3')
    expect(serializedToml).toContain('[settings.project]')
    expect(serializedToml).toContain('directory = "/tmp/projects"')
    expect(serializedToml).toContain('default_project_name = "plugin-template"')
    expect(serializedToml).toContain('[settings.command_bar]')
    expect(serializedToml).toContain('include_settings = false')
    expect(serializedToml).toContain('[settings.text_editor]')
    expect(serializedToml).toContain('text_wrapping = false')
    expect(serializedToml).toContain('blinking_cursor = false')
    expect(serializedToml).toContain('[settings.layout.configs]')
    expect(serializedToml).toContain('default = ')
    expect(serializedToml).not.toContain('[settings.zds')

    const parsedConfiguration = parseAppSettings(serializedToml, wasmInstance)
    if (parsedConfiguration instanceof Error) {
      throw parsedConfiguration
    }

    const parsedPayload = configurationToSettingsPayload(
      parsedConfiguration,
      projectLibrariesExtensionSettings
    )
    expect(parsedPayload.app?.onboardingStatus).toBe('dismissed')
    expect(parsedPayload.app?.allowOrbitInSketchMode).toBe(true)
    expect(parsedPayload.app?.machineApi).toBe(true)
    expect(parsedPayload.app?.showAllFiles).toBe(true)
    expect(parsedPayload.app?.projectDirectory).toBe('/tmp/projects')
    expect(parsedPayload.app?.libraries).toEqual([
      {
        title: 'Default Projects Directory',
        path: '/tmp/projects',
        type: 'directory',
      },
    ])
    expect(parsedPayload.debug?.showPanel).toBe(true)
    expect(parsedPayload.debug?.showModelingMachineState).toBe(true)
    expect(parsedPayload.projects?.defaultProjectName).toBe('plugin-template')
    expect(parsedPayload.modeling?.mouseControls).toBe('OnShape')
    expect(parsedPayload.modeling?.gizmoType).toBe('axis')
    expect(parsedPayload.modeling?.enableTouchControls).toBe(false)
    expect(parsedPayload.modeling?.useSketchSolveMode).toBe(false)
    expect(parsedPayload.modeling?.snapToGrid).toBe(true)
    expect(parsedPayload.modeling?.majorGridSpacing).toBe(2.5)
    expect(parsedPayload.modeling?.minorGridsPerMajor).toBe(5)
    expect(parsedPayload.modeling?.snapsPerMinor).toBe(3)
    expect(parsedPayload.commandBar?.includeSettings).toBe(false)
    expect(parsedPayload.textEditor?.textWrapping).toBe(false)
    expect(parsedPayload.textEditor?.blinkingCursor).toBe(false)
    expect(parsedPayload.layout?.configs?.default.version).toBe('v3')
    expect(parsedPayload.layout?.configs?.default.layout.id).toBe(
      defaultLayoutConfig.id
    )
  })

  it('uses the default directory library as the legacy project directory when parsing settings', () => {
    const parsedPayload = configurationToSettingsPayload(
      {
        settings: {
          app: {
            libraries: [
              {
                title: 'Projects',
                path: '/library-projects',
                type: 'directory',
              },
            ],
          },
          project: {
            directory: '/legacy-projects',
          },
        },
      },
      projectLibrariesExtensionSettings
    )

    expect(parsedPayload.app?.projectDirectory).toBe('/library-projects')
  })

  it('mirrors the default directory library into the legacy project directory when serializing settings', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    const serializedToml = serializeConfiguration(
      settingsPayloadToConfiguration(
        {
          app: {
            projectDirectory: '/legacy-projects',
            libraries: [
              {
                title: 'Projects',
                path: '/library-projects',
                type: 'directory',
              },
            ],
          },
        },
        projectLibrariesExtensionSettings
      ),
      wasmInstance
    )
    if (serializedToml instanceof Error) {
      throw serializedToml
    }

    expect(serializedToml).toContain('[settings.project]')
    expect(serializedToml).toContain('directory = "/library-projects"')
  })

  it('preserves extension-contributed plugin settings through wasm round-trip', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    const serializedToml = serializeConfiguration(
      settingsPayloadToConfiguration(
        {
          plugins: {
            telemetry: false,
          },
        },
        pluginExtensionSettings
      ),
      wasmInstance
    )
    if (serializedToml instanceof Error) {
      throw serializedToml
    }

    expect(serializedToml).toContain('[settings.plugins]')
    expect(serializedToml).toContain('telemetry = false')

    const parsedConfiguration = parseAppSettings(serializedToml, wasmInstance)
    if (parsedConfiguration instanceof Error) {
      throw parsedConfiguration
    }

    const parsedPayload = configurationToSettingsPayload(
      parsedConfiguration,
      pluginExtensionSettings
    )
    expect(parsedPayload.plugins?.telemetry).toBe(false)
  })

  it('preserves explicit project defaults when user values differ', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    let settings = createSettings()

    // Set User-level value to the non-default true
    setSettingsAtLevel(settings, 'user', {
      debug: { showPanel: true },
    })

    // Project-level value is set to the default value
    setSettingsAtLevel(settings, 'project', {
      debug: { showPanel: false },
    })

    const changedProjectSettings = getChangedSettingsAtLevel(
      settings,
      'project'
    )
    expect(changedProjectSettings.debug?.showPanel).toBe(false)

    const serializedToml = serializeProjectConfiguration(
      settingsPayloadToProjectConfiguration(changedProjectSettings),
      wasmInstance
    )
    if (serializedToml instanceof Error) {
      throw serializedToml
    }

    // Explicit project overrides should be present in serialized TOML.
    expect(serializedToml).toContain('show_panel = false')

    const parsedProjectConfiguration = parseProjectSettings(
      serializedToml,
      wasmInstance
    )
    if (parsedProjectConfiguration instanceof Error) {
      throw parsedProjectConfiguration
    }

    const parsedProjectPayload = projectConfigurationToSettingsPayload(
      parsedProjectConfiguration
    )
    // Technically this is enough to check for:
    // parsed debug.showPanel should be false
    expect(parsedProjectPayload.debug?.showPanel).toBe(false)

    // Double check: reapply parsed settings and verify project-level takes precedence
    settings = createSettings()
    setSettingsAtLevel(settings, 'user', {
      debug: { showPanel: true },
    })
    setSettingsAtLevel(settings, 'project', parsedProjectPayload)

    expect(settings.debug.showPanel.user).toBe(true)
    expect(settings.debug.showPanel.project).toBe(false)
    expect(settings.debug.showPanel.current).toBe(false)
  })

  it('preserves cloud metadata when project settings are reserialized', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    const existingProjectConfiguration: DeepPartial<ProjectConfiguration> = {
      settings: {
        meta: {
          id: 'e8f5178c-5227-4567-bb5a-f52b3caef5ea',
        },
      },
      cloud: {
        'dev.zoo.dev': {
          project_id: 'e9632dae-19ca-49ea-bcc1-ee8e34ff9de3',
        },
      },
    }

    const changedProjectSettings = settingsPayloadToProjectConfiguration({
      debug: {
        showPanel: true,
      },
    })

    const mergedProjectConfiguration = mergeProjectConfiguration(
      existingProjectConfiguration,
      changedProjectSettings
    )
    const serializedToml = serializeProjectConfiguration(
      mergedProjectConfiguration,
      wasmInstance
    )
    if (serializedToml instanceof Error) {
      throw serializedToml
    }

    expect(serializedToml).toContain('show_panel = true')
    expect(serializedToml).toContain(
      '[cloud."dev.zoo.dev"]\nproject_id = "e9632dae-19ca-49ea-bcc1-ee8e34ff9de3"'
    )

    const parsedProjectConfiguration = parseProjectSettings(
      serializedToml,
      wasmInstance
    )
    if (parsedProjectConfiguration instanceof Error) {
      throw parsedProjectConfiguration
    }

    expect(parsedProjectConfiguration.cloud?.['dev.zoo.dev']?.project_id).toBe(
      'e9632dae-19ca-49ea-bcc1-ee8e34ff9de3'
    )
  })

  it('preserves project-scoped app-owned settings through wasm round-trip', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    const serializedToml = serializeProjectConfiguration(
      settingsPayloadToProjectConfiguration({
        app: {
          onboardingStatus: 'dismissed',
          allowOrbitInSketchMode: true,
        },
        debug: {
          showPanel: false,
          showModelingMachineState: true,
        },
        modeling: {
          snapToGrid: true,
          majorGridSpacing: 2.5,
          minorGridsPerMajor: 5,
          snapsPerMinor: 3,
        },
        commandBar: {
          includeSettings: false,
        },
        textEditor: {
          textWrapping: false,
          blinkingCursor: true,
        },
      }),
      wasmInstance
    )
    if (serializedToml instanceof Error) {
      throw serializedToml
    }

    expect(serializedToml).toContain('onboarding_status = "dismissed"')
    expect(serializedToml).toContain('allow_orbit_in_sketch_mode = true')
    expect(serializedToml).toContain('[settings.debug]')
    expect(serializedToml).toContain('show_panel = false')
    expect(serializedToml).toContain('show_modeling_machine_state = true')
    expect(serializedToml).toContain('snap_to_grid = true')
    expect(serializedToml).toContain('major_grid_spacing = 2.5')
    expect(serializedToml).toContain('minor_grids_per_major = 5')
    expect(serializedToml).toContain('snaps_per_minor = 3')
    expect(serializedToml).toContain('[settings.command_bar]')
    expect(serializedToml).toContain('include_settings = false')
    expect(serializedToml).toContain('[settings.text_editor]')
    expect(serializedToml).toContain('text_wrapping = false')
    expect(serializedToml).toContain('blinking_cursor = true')

    const parsedProjectConfiguration = parseProjectSettings(
      serializedToml,
      wasmInstance
    )
    if (parsedProjectConfiguration instanceof Error) {
      throw parsedProjectConfiguration
    }

    const parsedProjectPayload = projectConfigurationToSettingsPayload(
      parsedProjectConfiguration
    )
    expect(parsedProjectPayload.app?.onboardingStatus).toBe('dismissed')
    expect(parsedProjectPayload.app?.allowOrbitInSketchMode).toBe(true)
    expect(parsedProjectPayload.debug?.showPanel).toBe(false)
    expect(parsedProjectPayload.debug?.showModelingMachineState).toBe(true)
    expect(parsedProjectPayload.modeling?.snapToGrid).toBe(true)
    expect(parsedProjectPayload.modeling?.majorGridSpacing).toBe(2.5)
    expect(parsedProjectPayload.modeling?.minorGridsPerMajor).toBe(5)
    expect(parsedProjectPayload.modeling?.snapsPerMinor).toBe(3)
    expect(parsedProjectPayload.commandBar?.includeSettings).toBe(false)
    expect(parsedProjectPayload.textEditor?.textWrapping).toBe(false)
    expect(parsedProjectPayload.textEditor?.blinkingCursor).toBe(true)
  })

  it('drops cleared project settings while preserving project metadata', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    const existingProjectConfiguration: DeepPartial<ProjectConfiguration> = {
      settings: {
        meta: {
          id: 'e8f5178c-5227-4567-bb5a-f52b3caef5ea',
        },
        modeling: {
          base_unit: 'cm',
        },
        app: {
          named_views: {
            '0656fb1a-9640-473e-b334-591dc70c0138': {
              name: 'uuid1',
              eye_offset: 1,
              fov_y: 1,
              ortho_scale_enabled: false,
              ortho_scale_factor: 1,
              pivot_position: [0, 0, 0],
              pivot_rotation: [0, 0, 0, 1],
              world_coord_system: 'right_handed_up_z',
              is_ortho: false,
              version: 1,
            },
          },
        },
      },
      cloud: {
        'dev.zoo.dev': {
          project_id: 'e9632dae-19ca-49ea-bcc1-ee8e34ff9de3',
        },
      },
    }

    const rewrittenProjectConfiguration =
      replaceProjectSettingsPreservingMetadata(
        existingProjectConfiguration,
        settingsPayloadToProjectConfiguration({})
      )
    const serializedToml = serializeProjectConfiguration(
      rewrittenProjectConfiguration,
      wasmInstance
    )
    if (serializedToml instanceof Error) {
      throw serializedToml
    }

    expect(serializedToml).not.toContain('base_unit = "cm"')
    expect(serializedToml).not.toContain('named_views')
    expect(serializedToml).toContain(
      'id = "e8f5178c-5227-4567-bb5a-f52b3caef5ea"'
    )
    expect(serializedToml).toContain(
      '[cloud."dev.zoo.dev"]\nproject_id = "e9632dae-19ca-49ea-bcc1-ee8e34ff9de3"'
    )
  })

  it('preserves debug settings through the app debug section', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    const parsedConfiguration = parseAppSettings(
      '[settings.debug]\nshow_panel = true\nshow_modeling_machine_state = false\n',
      wasmInstance
    )
    if (parsedConfiguration instanceof Error) {
      throw parsedConfiguration
    }

    const parsedPayload = configurationToSettingsPayload(parsedConfiguration)
    expect(parsedPayload.debug?.showPanel).toBe(true)
    expect(parsedPayload.debug?.showModelingMachineState).toBe(false)
  })

  it('preserves debug settings through the project debug section', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    const parsedProjectConfiguration = parseProjectSettings(
      '[settings.debug]\nshow_panel = false\nshow_modeling_machine_state = true\n',
      wasmInstance
    )
    if (parsedProjectConfiguration instanceof Error) {
      throw parsedProjectConfiguration
    }

    const parsedProjectPayload = projectConfigurationToSettingsPayload(
      parsedProjectConfiguration
    )
    expect(parsedProjectPayload.debug?.showPanel).toBe(false)
    expect(parsedProjectPayload.debug?.showModelingMachineState).toBe(true)
  })
})

describe('formatSettingsLabel', () => {
  it('capitalizes known initialisms', () => {
    expect(formatSettingsLabel('machineApi')).toBe('machine API')
    expect(formatSettingsLabel('siteUrl')).toBe('site URL')
    expect(formatSettingsLabel('projectId')).toBe('project ID')
    expect(formatSettingsLabel('showUi')).toBe('show UI')
  })
})
