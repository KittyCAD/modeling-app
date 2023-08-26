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
        defaultValue: 'theme',
        options: Object.values(Themes).map((v) => ({ name: v })) as {
          name: string
        }[],
      },
    ],
  },
  'Set Default Project Name': {
    displayValue: (args: string[]) => 'Set a new default project name',
    hide: 'web',
    args: [
      {
        name: 'defaultProjectName',
        type: 'string',
        description: '(default)',
        defaultValue: 'defaultProjectName',
        options: 'defaultProjectName',
      },
    ],
  },
  'Set Default Directory': {
    hide: 'both',
  },
  'Set Unit System': {
    displayValue: (args: string[]) => 'Set your default unit system',
    args: [
      {
        name: 'unitSystem',
        type: 'select',
        defaultValue: 'unitSystem',
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
        defaultValue: 'baseUnit',
        options: Object.values(baseUnitsUnion).map((v) => ({ name: v })),
      },
    ],
  },
  'Set Onboarding Status': {
    hide: 'both',
  },
}

export const settingsMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlTQAIAVACzAFswBtABgF1FQAHAe1iYsfbNxAAPRAA42+AEwB2KQFYAzGznKAnADZli1QBoQAT2kBGKfm37lOned3nzqgL6vjlLLgJFSFdCoAETAAMwBDAFdiagAFACc+ACswAGNqADlw5nYuJBB+QWFRfMkEABY5fDYa2rra83LjMwQdLWV8BXLyuxlVLU1Ld090bzxCEnJKYLComODMeLS0PniTXLFCoUwRMTK7fC1zNql7NgUjtnKjU0RlBSqpLVUVPVUda60tYZAvHHG-FNAgBVbBCKjIEywNBMDb5LbFPaILqdfRSORsS4qcxXZqIHqyK6qY4XOxsGTKco-P4+Cb+aYAIXCsDAVFBQjhvAE212pWkskUKnUml0+gUNxaqkU+EccnKF1UCnucnMcjcHl+o3+vkmZBofCgUFIMwARpEoFRYuFsGBiJyCtzEXzWrJlGxlKdVFKvfY1XiEBjyvhVOVzBdzu13pYFNStbTAQFqAB5bAmvjheIQf4QtDhNCRWD2hE7EqgfayHTEh7lHQNSxSf1Scz4cpHHFyFVujTKczuDXYPgQOBiGl4TaOktIhAAWg6X3nC4Xp39050sYw2rpYHHRUnztVhPJqmUlIGbEriv9WhrLZ6uibHcqUr7riAA */
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
              'toastSuccess',
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
              'toastSuccess',
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
              'toastSuccess',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Unit System': {
            actions: [
              assign({
                unitSystem: (_, event) => event.data.unitSystem,
                baseUnit: (_, event) =>
                  event.data.unitSystem === 'imperial' ? 'in' : 'mm',
              }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Base Unit': {
            actions: [
              assign({ baseUnit: (_, event) => event.data.baseUnit }),
              'persistSettings',
              'toastSuccess',
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
              'toastSuccess',
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
              'toastSuccess',
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
