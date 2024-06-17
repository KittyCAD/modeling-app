import { assign, createMachine } from 'xstate'
import { Themes, getSystemTheme, setThemeClass } from 'lib/theme'
import { createSettings, settings } from 'lib/settings/initialSettings'
import {
  BaseUnit,
  SetEventTypes,
  SettingsLevel,
  SettingsPaths,
  WildcardSetEvent,
} from 'lib/settings/settingsTypes'

export const settingsMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlnXwEMAHW-Ae2wCNHqAnCHKZNatAFdYAbQAMAXUShajWJizNpIAB6IALAFYAnPgBMARgDsBsQDY969QGYjmzQBoQAT0SnrADnwePY61r0PAwNtMyMAX3CnVAweAiJSCio6BjQACzAAWzAAYUZiRg5xKSQQWXlFbGU1BD1PfFtfE3UzTUNNaydXBCD1b209PTEPTTMtdQNNSOj0LFx4knJKNHxMxggwYh58DYAzakFiNABVbAVi5XKFTCVSmsGxfCMPM08PQaDNU0cXRG1tLwedTaKxif7+UJTKIgGJzPCERZJFYpfDpLJgC6lK6VaqIEx6fBmCw2Do2IJ6MxdRDvTT4MRDdRGEzWbQ6ELTGGzOIIxLLVbrTbbNKYKBpLaitAAUWgcExMjk11uoBqVgM3jMYhsAIMrVs6ipPWChOeYhC9KMFhGHNh3IS5AASnB0AACZZw0SSS4KnF3PFafADTV1YZ2IxiH7dNpGfCaIzAgE+IzWMzBa1c+Y88gxZ3UYjEV3pvBysrem5VX0IFq0y3aTXWOp6JmU34IKMxuz0joGEYWsxp2IZu1kABUxexZdxtRG+EmQMZmne3dNBs0jKewLBsbCwI81n77vwtDAHHksDhBYHeDIEGYYEI2AAbowANZ3o8nzBnm3zMelpWqRAAFp62sJ4jEsZ4AT0UJGwjPFzH6cwNW0AwWXpbRImhbABXgUpvzwL0KgnCtgJMMCII8KCYLsA11EGOkXneDxmXMCk92hfCFlIQjFXLZUgLjddWhaFkgRCaxOhbEYzBnXwXkmOjAjjfduXfU9zzdOIeJ9fiEEA6ckwMClQ2BFpmJXMF9DjYI6hZfxmMw8IgA */
    id: 'Settings',
    predictableActionArguments: true,
    context: {} as ReturnType<typeof createSettings>,
    initial: 'idle',
    states: {
      idle: {
        entry: ['setThemeClass', 'setClientSideSceneUnits'],

        on: {
          '*': {
            target: 'persisting settings',
            actions: ['setSettingAtLevel', 'toastSuccess'],
          },

          'set.app.onboardingStatus': {
            target: 'persisting settings',

            // No toast
            actions: ['setSettingAtLevel'],
          },
          'set.app.themeColor': {
            target: 'persisting settings',

            // No toast
            actions: ['setSettingAtLevel'],
          },

          'set.modeling.defaultUnit': {
            target: 'persisting settings',

            actions: [
              'setSettingAtLevel',
              'toastSuccess',
              'setClientSideSceneUnits',
              'Execute AST',
            ],
          },

          'set.app.theme': {
            target: 'persisting settings',

            actions: [
              'setSettingAtLevel',
              'toastSuccess',
              'setThemeClass',
              'setEngineTheme',
              'setClientTheme',
            ],
          },

          'set.modeling.highlightEdges': {
            target: 'persisting settings',

            actions: ['setSettingAtLevel', 'toastSuccess', 'setEngineEdges'],
          },

          'Reset settings': {
            target: 'persisting settings',

            actions: [
              'resetSettings',
              'setThemeClass',
              'setEngineTheme',
              'setClientSideSceneUnits',
              'Execute AST',
              'setClientTheme',
            ],
          },

          'Set all settings': {
            target: 'persisting settings',

            actions: [
              'setAllSettings',
              'setThemeClass',
              'setEngineTheme',
              'setClientSideSceneUnits',
              'Execute AST',
              'setClientTheme',
            ],
          },
        },
      },

      'persisting settings': {
        invoke: {
          src: 'Persist settings',
          id: 'persistSettings',
          onDone: 'idle',
        },
      },
    },
    tsTypes: {} as import('./settingsMachine.typegen').Typegen0,
    schema: {
      events: {} as
        | WildcardSetEvent<SettingsPaths>
        | SetEventTypes
        | {
            type: 'set.app.theme'
            data: { level: SettingsLevel; value: Themes }
          }
        | {
            type: 'set.modeling.units'
            data: { level: SettingsLevel; value: BaseUnit }
          }
        | { type: 'Reset settings'; defaultDirectory: string }
        | { type: 'Set all settings'; settings: typeof settings },
    },
  },
  {
    actions: {
      resetSettings: assign((context, { defaultDirectory }) => {
        // Reset everything except onboarding status,
        // which should be preserved
        const newSettings = createSettings()
        if (context.app.onboardingStatus.user) {
          newSettings.app.onboardingStatus.user =
            context.app.onboardingStatus.user
        }
        // We instead pass in the default directory since it's asynchronous
        // to re-initialize, and that can be done by the caller.
        newSettings.app.projectDirectory.default = defaultDirectory

        return newSettings
      }),
      setAllSettings: assign((_, event) => {
        return event.settings
      }),
      setSettingAtLevel: assign((context, event) => {
        const { level, value } = event.data
        const [category, setting] = event.type
          .replace(/^set./, '')
          .split('.') as [keyof typeof settings, string]

        // @ts-ignore
        context[category][setting][level] = value

        const newContext = {
          ...context,
          [category]: {
            ...context[category],
            // @ts-ignore
            [setting]: context[category][setting],
          },
        }

        return newContext
      }),
      setThemeClass: (context) => {
        const currentTheme = context.app.theme.current ?? Themes.System
        setThemeClass(
          currentTheme === Themes.System ? getSystemTheme() : currentTheme
        )
      },
    },
  }
)
