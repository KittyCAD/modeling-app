import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import { join } from 'path'

import {
  parseProjectSettings,
  serializeProjectConfiguration,
} from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { createSettings, type Setting } from '@src/lib/settings/initialSettings'
import {
  configurationToSettingsPayload,
  getChangedSettingsAtLevel,
  getAllCurrentSettings,
  hiddenOnPlatform,
  projectConfigurationToSettingsPayload,
  settingsPayloadToProjectConfiguration,
  setSettingsAtLevel,
} from '@src/lib/settings/settingsUtils'
import type { DeepPartial } from '@src/lib/types'
import { expect, describe, it } from 'vitest'

describe(`testing settings initialization`, () => {
  it(`sets settings at the 'user' level`, () => {
    let settings = createSettings()
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
    let settings = createSettings()
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
          // @ts-expect-error: our types are smart enough to know this isn't valid, but we're testing it.
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
})

describe(`testing getAllCurrentSettings`, () => {
  it(`returns the correct settings`, () => {
    // Set up the settings
    let settings = createSettings()
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
})

// This tests if default project level settings can override non-default user level settings.
// Eg.:
// user.showDebugPanel = true
// project.showDebugPanel = false (the default is false)
// Then we expect showDebugPanel to resolve to false.
// We used to have a bug where this project level default value was not serialized,
// this regression test protects against that.

describe('project settings serialization regression', () => {
  it('preserves explicit project defaults when user values differ', async () => {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)

    let settings = createSettings()

    // Set User-level value to the non-default true
    setSettingsAtLevel(settings, 'user', {
      app: { showDebugPanel: true },
    })

    // Project-level value is set to the default value
    setSettingsAtLevel(settings, 'project', {
      app: { showDebugPanel: false },
    })

    const changedProjectSettings = getChangedSettingsAtLevel(
      settings,
      'project'
    )
    expect(changedProjectSettings.app?.showDebugPanel).toBe(false)

    const serializedToml = serializeProjectConfiguration(
      settingsPayloadToProjectConfiguration(changedProjectSettings),
      wasmInstance
    )
    if (serializedToml instanceof Error) throw serializedToml

    // Explicit project overrides should be present in serialized TOML.
    expect(serializedToml).toContain('show_debug_panel = false')

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
    // parsed showDebugPanel should be false
    expect(parsedProjectPayload.app?.showDebugPanel).toBe(false)

    // Double check: reapply parsed settings and verify project-level takes precedence
    settings = createSettings()
    setSettingsAtLevel(settings, 'user', {
      app: { showDebugPanel: true },
    })
    setSettingsAtLevel(settings, 'project', parsedProjectPayload)

    expect(settings.app.showDebugPanel.user).toBe(true)
    expect(settings.app.showDebugPanel.project).toBe(false)
    expect(settings.app.showDebugPanel.current).toBe(false)
  })
})
