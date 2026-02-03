import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'

import { createSettings, type Setting } from '@src/lib/settings/initialSettings'
import {
  configurationToSettingsPayload,
  getAllCurrentSettings,
  hiddenOnPlatform,
  projectConfigurationToSettingsPayload,
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
