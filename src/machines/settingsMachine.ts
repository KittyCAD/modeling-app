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
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlnXwEMAHW-Ae2wCNHqAnCHKZNatAFdYAbQAMAXUShajWJizNpIAB6IALAFYAnPgBMARgDsBsQDY969QGYjmzQBoQAT0SnrADnwePY61r0PAwNtMyMAX3CnVAweAiJSCio6BjQACzAAWzAAYUZiRg5xKSQQWXlFbGU1BD1PfFtfE3UzTUNNaydXBCD1b209PTEPTTMtdQNNSOj0LFx4knJKNHxMxggwYh58DYAzakFiNABVbAVi5XKFTCVSmusxPXx7bRt1DzMxI3UjD3UutwhAz4MyeHxiV5+AYRKIgGJzPCERZJFYpfDpLJgC6lK6VaqIExPMwWGwdGxBPRmAE9PSafCPMQ-EzWbQ6ELTOGzOJIxLLVbrTbbNKYKBpLaitAAUWgcGxMjk11uoBqVmBH0ZLKCrVs-xciCCwLCvhCjyMFhGHPh3IS5AASnB0AACZYI0SSS4KvF3AlafADRl1YZ2IxiRx6hBtIzPb7abQ+DxGaxmYKWrnzHnkGKO6jEYjOtN4OVlT03KrehAtOnm7Qaup6Ixm6mR6OaR4dAwjM1mVOxdM2lH8jZbXD4WBpRgAd2QAGMc2AAOIcIhF3Gl-EIRPA6yGcyh4whSnU0xGJ5GAat0OfFowma9xH9gBUK5LStUiECdMmfx+mg8hmNTY-PgMYQpoZoxh41g9q6+C0GAHDyLACL5nesBkBAzBgIQ2AAG6MAA1lhcEIZgSFWvMz4VGu5YALTbtYwEnj8HhxnooT1mG3QhmY-TmJ82gGCyjzaJEsLYAK8ClOReAelRr41HRJiMZYvysexdjUuohh+poBiGDuXzGKy0HWossmKmWyqIDR3zAZWLSahM2jWJ04YjDxHbDMmmhaYE3wmemxGIchLpxOZXpWQgNEjMB1h6WEYHqK8ZgJk2EL6N8wR1Cy-gJqJ4RAA */
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
            target: "persisting settings",

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

          'set.modeling.showScaleGrid': {
            target: 'persisting settings',
            actions: [
              'setSettingAtLevel',
              'toastSuccess',
              'setEngineScaleGridVisibility',
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
