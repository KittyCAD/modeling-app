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
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlnXwEMAHW-Ae2wCNHqAnCHKZNatAFdYAbQAMAXUShajWJizNpIAB6IAbAFZN+AOwAWAIwAOYwE4AzGYBM+-ZosAaEAE9Eh62LP51ls+v0LMWt1awMAX3DnVAweAiJSCio6BjQACzAAWzAAYUZiRg5xKSQQWXlFbGU1BA9vQ0N1CwCxdVbdY1DnNwQzPp8zTTFje1D1QwtjSOj0LFx4knJKNHxMxggwYh58DYAzakFiNABVbAVi5XKFTCVSmotNY3w7YysHRuNDTXV1bvdG7w-IKTcbaazWCzTEAxOZ4QiLJIrFL4dJZMAXUpXSrVDTGazPMQPR4GXRBAx-XoGfDWIadMx4n6EqEwuLwxLLVbrTbbNKYKBpLb8tAAUWgcAxMjk11uoHumn0+DEw2sJkMulCgWsFL6YnwfX0ELsYg61jMumZs1ZCXIACU4OgAATLWGiSSXKXYu4aLz4UwWBr6DqBYYUzSePXqUlBLxmyZmC2xeZs8gxB3UYjEJ2W+YSsoem5VL0IKy6z6EsJifQ2Czq0MTHzq8Yjfz6MQmBMu5NkABUuaxBZxCDD+DD5lJgUjxssFP0xl0I+0pm06uMmg8kSiIGwXPgpRZ83dFQHRYAtA0LCO2tZjGIHJNdB5fq5EK3dc1OsNGkrA+oO1bFoe0qFrKiAnlol7BDed5zo+FK+Doc7qhCNaVv4UwbkAA */
    id: 'Settings',
    predictableActionArguments: true,
    context: {} as ReturnType<typeof createSettings>,
    initial: 'idle',
    states: {
      idle: {
        entry: ['setThemeClass', 'setClientSideSceneUnits', 'persistSettings'],

        on: {
          '*': {
            target: 'idle',
            internal: true,
            actions: ['setSettingAtLevel', 'toastSuccess', 'persistSettings'],
          },

          'set.app.onboardingStatus': {
            target: 'idle',
            internal: true,
            actions: ['setSettingAtLevel', 'persistSettings'], // No toast
          },
          'set.app.themeColor': {
            target: 'idle',
            internal: true,
            actions: ['setSettingAtLevel', 'persistSettings'], // No toast
          },

          'set.modeling.defaultUnit': {
            target: 'idle',
            internal: true,
            actions: [
              'setSettingAtLevel',
              'toastSuccess',
              'setClientSideSceneUnits',
              'Execute AST',
              'persistSettings',
            ],
          },

          'set.app.theme': {
            target: 'idle',
            internal: true,
            actions: [
              'setSettingAtLevel',
              'toastSuccess',
              'setThemeClass',
              'setEngineTheme',
              'persistSettings',
              'setClientTheme',
            ],
          },

          'set.modeling.highlightEdges': {
            target: 'idle',
            internal: true,
            actions: [
              'setSettingAtLevel',
              'toastSuccess',
              'setEngineEdges',
              'persistSettings',
            ],
          },

          'Reset settings': {
            target: 'idle',
            internal: true,
            actions: [
              'resetSettings',
              'setThemeClass',
              'setEngineTheme',
              'setClientSideSceneUnits',
              'Execute AST',
              'persistSettings',
              'setClientTheme',
            ],
          },

          'Set all settings': {
            target: 'idle',
            internal: true,
            actions: [
              'setAllSettings',
              'setThemeClass',
              'setEngineTheme',
              'setClientSideSceneUnits',
              'Execute AST',
              'persistSettings',
              'setClientTheme',
            ],
          },
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
