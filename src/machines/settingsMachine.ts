import { assign, createMachine } from 'xstate'
import { Themes, getSystemTheme, setThemeClass } from 'lib/theme'
import {
  createSettings,
  settings,
  SettingsLevel,
} from 'lib/settings/initialSettings'
import { Leaves, PathValue } from 'lib/types'
import { BaseUnit } from 'lib/settings/settingsTypes'
import { setPropertyByPath } from 'lib/objectPropertyByPath'
import { getChangedSettingsAtLevel } from 'lib/settings/settingsUtils'
import { writeToSettingsFiles } from 'lib/tauriFS'
import { isTauri } from 'lib/isTauri'

type SetEvent<T extends Leaves<typeof settings>> = {
  type: `set.${T}`
  data: {
    path: T
    value: PathValue<typeof settings, T>
  }
}

type SetEventTypes = SetEvent<Leaves<typeof settings>>

type WildcardSetEvent<T extends Leaves<typeof settings>> = {
  type: `*`
  data: {
    path: T
    value: PathValue<typeof settings, T>
  }
}

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

          'set.app.theme.user': {
            target: 'idle',
            internal: true,
            actions: ['setSettingAtLevel', 'toastSuccess', 'setThemeClass', 'persistSettings'],
          },
          'set.app.theme.project': {
            target: 'idle',
            internal: true,
            actions: ['setSettingAtLevel', 'toastSuccess', 'setThemeClass', 'persistSettings'],
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
        | WildcardSetEvent<Leaves<typeof settings>>
        | SetEventTypes
        | {
            type: `set.app.theme.${SettingsLevel}`
            data: { path: `app.theme.${SettingsLevel}`; value: Themes }
          }
        | {
            type: 'set.modeling.units'
            data: { path: `modeling.units.${SettingsLevel}`; value: BaseUnit }
          }
        | { type: 'Reset settings' },
    },
  },
  {
    actions: {
      resetSettings: assign(createSettings()),
      setSettingAtLevel: assign((context, event) => {
        const { path, value } = event.data
        const [category, setting, level] = path.split('.') as [
          keyof typeof settings,
          string,
          SettingsLevel
        ]

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
      setThemeClass: (context, event) => {
        const currentTheme =
          (event.type === 'set.app.theme.project' || event.type === 'set.app.theme.user')
            ? (event.data.value as Themes)
            : context.app.theme.current ?? Themes.System
        setThemeClass(
          currentTheme === Themes.System ? getSystemTheme() : currentTheme
        )
      },
      persistSettings: (context, event) => {
        console.log('context', context)
        console.log('event', event)
        if (isTauri()) {
          writeToSettingsFiles(context)
        }
      },
    },
  }
)
