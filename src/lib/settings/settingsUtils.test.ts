import { DeepPartial } from 'lib/types'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import {
  configurationToSettingsPayload,
  projectConfigurationToSettingsPayload,
  setSettingsAtLevel,
} from './settingsUtils'
import { createSettings } from './initialSettings'

describe(`testing settings initialization`, () => {
  it(`sets settings at the 'user' level`, () => {
    let settings = createSettings()
    const appConfiguration: DeepPartial<Configuration> = {
      settings: {
        app: {
          appearance: {
            theme: 'dark',
            color: 190,
          },
        },
      },
    }

    const appSettingsPayload = configurationToSettingsPayload(appConfiguration)

    setSettingsAtLevel(settings, 'user', appSettingsPayload)

    expect(settings.app.theme.current).toBe('dark')
    expect(settings.app.themeColor.current).toBe('190')
  })

  it(`doesn't read theme from project settings`, () => {
    let settings = createSettings()
    const appConfiguration: DeepPartial<Configuration> = {
      settings: {
        app: {
          appearance: {
            theme: 'dark',
            color: 190,
          },
        },
      },
    }
    const projectConfiguration: DeepPartial<Configuration> = {
      settings: {
        app: {
          appearance: {
            theme: 'light',
            color: 200,
          },
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
    // But the 'project'-level for `themeColor` setting should be applied
    expect(settings.app.themeColor.current).toBe('200')
  })
})
