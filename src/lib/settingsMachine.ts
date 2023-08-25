import { assign, createMachine } from 'xstate'
import { BaseUnit, baseUnitsUnion } from '../useStore'
import { CommandBarMeta } from './commands'
import { Themes } from './theme'

export const SETTINGS_PERSIST_KEY = 'SETTINGS_PERSIST_KEY'

export const settingsCommandBarMeta: CommandBarMeta = {
  'Set Theme': {
    displayValue: (args: string[]) => 'Change the app theme',
    args: [
      {
        name: 'theme',
        type: 'select',
        options: Object.values(Themes).map((v) => ({ name: v })) as {
          name: string
        }[],
      },
    ],
  },
  'Set Default Project Name': {
    displayValue: (args: string[]) => 'Set a new default project name',
    args: [
      {
        name: 'defaultProjectName',
        type: 'string',
        options: 'defaultProjectName',
      },
    ],
  },
  'Set Default Directory': {
    hide: true,
  },
  'Set Unit System': {
    displayValue: (args: string[]) => 'Set your default unit system',
    args: [
      {
        name: 'unitSystem',
        type: 'select',
        options: [{ name: 'imperial' }, { name: 'metric' }],
      },
    ],
  },
  'Set Base Unit': {
    displayValue: (args: string[]) => 'Set your default base unit',
    args: [
      {
        name: 'baseUnit',
        type: 'select',
        options: Object.values(baseUnitsUnion).map((v) => ({ name: v })),
      },
    ],
  },
  'Set Onboarding Status': {
    hide: true,
  },
}

export const settingsMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYgFEA3MbNAAgEYBtABgF1FQAHAe1kxZe2LiAAeiAJwBmfABZJrVo2mMATGoCsmgBwA2ADQgAnojUB2WXL2TG582uusZ5zQF8PR7LwhxRqDBw8UT4BIREkcUQAWkMTRE1WfESdW0YVNR11dzcjAKxcAiJSEP5BTGFRCQQ5NSNTBBUdDw8gA */
    id: 'Settings',
    predictableActionArguments: true,
    context: {
      theme: Themes.System,
      defaultProjectName: '',
      unitSystem: 'imperial' as 'imperial' | 'metric',
      baseUnit: 'in' as BaseUnit,
      defaultDirectory: '',
      showDebugPanel: false,
      onboardingStatus: '',
    },
    initial: 'idle',
    states: {
      idle: {
        on: {
          'Set Theme': {
            actions: [
              assign({
                theme: (_, event) => event.data.theme,
              }),
              'persistSettings',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Default Project Name': {
            actions: [
              assign({
                defaultProjectName: (_, event) => event.data.defaultProjectName,
              }),
              'persistSettings',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Default Directory': {
            actions: [
              assign({
                defaultDirectory: (_, event) => event.data.defaultDirectory,
              }),
              'persistSettings',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Unit System': {
            actions: [
              assign({
                unitSystem: (_, event) => event.data.unitSystem,
              }),
              'persistSettings',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Base Unit': {
            actions: [
              assign({ baseUnit: (_, event) => event.data.baseUnit }),
              'persistSettings',
            ],
            target: 'idle',
            internal: true,
          },
          'Toggle Debug Panel': {
            actions: [
              assign({
                showDebugPanel: (context) => {
                  return !context.showDebugPanel
                },
              }),
              'persistSettings',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Onboarding Status': {
            actions: [
              assign({
                onboardingStatus: (_, event) => event.data.onboardingStatus,
              }),
              'persistSettings',
            ],
            target: 'idle',
            internal: true,
          },
        },
      },
    },
    tsTypes: {} as import('./settingsMachine.typegen').Typegen0,
    schema: {
      events: {} as
        | { type: 'Set Theme'; data: { theme: Themes } }
        | {
            type: 'Set Default Project Name'
            data: { defaultProjectName: string }
          }
        | { type: 'Set Default Directory'; data: { defaultDirectory: string } }
        | {
            type: 'Set Unit System'
            data: { unitSystem: 'imperial' | 'metric' }
          }
        | { type: 'Set Base Unit'; data: { baseUnit: BaseUnit } }
        | { type: 'Set Onboarding Status'; data: { onboardingStatus: string } }
        | { type: 'Toggle Debug Panel' },
    },
  },
  {
    actions: {
      persistSettings: (context) => {
        try {
          localStorage.setItem(SETTINGS_PERSIST_KEY, JSON.stringify(context))
        } catch (e) {
          console.error(e)
        }
      },
    },
  }
)
