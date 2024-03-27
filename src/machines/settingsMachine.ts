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
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlnXwFsB7CMYnKfAV20zVgG0AGAXUSgADrVidMtbEJAAPRABYAHAFZ8vAEwA2FVq0aNAZgCcARl0B2ADQgAnolO8LvfBYUXT+48YW+tCgF8Am1QMZgIiUgoqAENhYXw0AAswajA+QSQQUXEsKRl5BCM1DQUDMo0VQwVjJxt7BFMDJXwNWo0LFSU3c0DgkFCsXAiScgAlOHQAAkow4YyZHIl8rMKAWn18Q39q3ScVFQ1NFXqHXiVTfGNqhSdeXi1DJQ1TIJD0IbxCUbIAKgWsks8tJVopjFp8KZjEpqi9lKZDE0TnYzgZXO5PG0fH4+u85l9IuRQlMYsRiFNsGAAO4zD7hAEiMTLEGgda6fAKJoIiyIkwWYwWawoxpGFxaHkKFS1a7woL9bD0OAyQbhRZM4EFRBrUyOLY7SVafaHTSnBDGDqQiz6DRKbwqTxvAZ04bfUhq3KSFlyBxHdQIhR6HTQmoC02OUwKPW7GrPdy8QxygJAA */
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
            ],
          },

          'Reset settings': {
            target: 'idle',
            internal: true,
            actions: ['resetSettings', 'persistSettings'],
          },

          'Set all settings': {
            target: 'idle',
            internal: true,
            actions: [
              'setAllSettings',
              'setThemeClass',
              'setEngineTheme',
              'Execute AST',
              'setClientSideSceneUnits',
              'persistSettings',
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
        | { type: 'Reset settings' }
        | { type: 'Set all settings'; settings: typeof settings },
    },
  },
  {
    actions: {
      resetSettings: assign(createSettings()),
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
