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
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlnXwCoBtABgF1FQAHAe1ky3exZAAeiAEwBmAIz4A7OIBsU+lICssgJxLV9WQA4ANCACeibUvr5hSjfVHb6FqSYC+j-agw48hEuUpp8AW3YIMGIPfABXbG5YBmYkEA4uHj54oQQAFhN8O1kVWWExVXEVKX0jBHFFMyl0mXzVVXSm2XTnV3QsXAIiUgoqAENWVnw0AAswfzBY-kTuTF5+NLElc3SCtYtRdM1Sw0RxAu1zTWFlbRri1pcQN07PHvIAJTh0AAJfO5imGc45hdTEABafL4UQtLYqRSWYR2JRlfb0bSSVRbdJVLQ2YTiZzXbBBOD8W4eeDxWbJRZA8SVUHg9KQ5RKGHCeEIKQglGiOyiTk2JQ2No3DrErykH5JeYpUBpA5mejiLayRUabTbVS7cqVcTpGkQ7baYS1aw4xxAA */
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

          'set.modeling.units': {
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
              'persistSettings',
            ],
          },

          'Reset settings': {
            target: 'idle',
            internal: true,
            actions: ['resetSettings', 'persistSettings'],
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
        | { type: 'Reset settings' },
    },
  },
  {
    actions: {
      resetSettings: assign(createSettings()),
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
