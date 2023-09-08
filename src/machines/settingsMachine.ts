import { assign, createMachine } from 'xstate'
import { BaseUnit, baseUnitsUnion } from '../useStore'
import { CommandBarMeta } from '../lib/commands'
import { Themes, getSystemTheme, setThemeClass } from '../lib/theme'
import { CADProgram, cadPrograms } from 'lib/cameraControls'

export enum UnitSystem {
  Imperial = 'imperial',
  Metric = 'metric',
}

export const SETTINGS_PERSIST_KEY = 'SETTINGS_PERSIST_KEY'

export const settingsCommandBarMeta: CommandBarMeta = {
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
  'Set Camera Controls': {
    displayValue: (args: string[]) => 'Set your camera controls',
    args: [
      {
        name: 'cameraControls',
        type: 'select',
        defaultValue: 'cameraControls',
        options: Object.values(cadPrograms).map((v) => ({ name: v })),
      },
    ],
  },
  'Set Default Directory': {
    hide: 'both',
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
  'Set Onboarding Status': {
    hide: 'both',
  },
  'Set Text Wrapping': {
    displayValue: (args: string[]) => 'Set whether text in the editor wraps',
    args: [
      {
        name: 'textWrapping',
        type: 'select',
        defaultValue: 'textWrapping',
        options: [{ name: 'On' }, { name: 'Off' }],
      },
    ],
  },
  'Set Theme': {
    displayValue: (args: string[]) => 'Change the app theme',
    args: [
      {
        name: 'theme',
        type: 'select',
        defaultValue: 'theme',
        options: Object.values(Themes).map((v): { name: string } => ({
          name: v,
        })),
      },
    ],
  },
  'Set Unit System': {
    displayValue: (args: string[]) => 'Set your default unit system',
    args: [
      {
        name: 'unitSystem',
        type: 'select',
        defaultValue: 'unitSystem',
        options: [{ name: UnitSystem.Imperial }, { name: UnitSystem.Metric }],
      },
    ],
  },
}

export const settingsMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlTQAIAVACzAFswBtABgF1FQAHAe1iYsfbNxAAPRAA42+AEwB2KQFYAzGznKAnADZli1QBoQAT2kBGKfm37lOned3nzqgL6vjlLLgJFSFdCoAETAAMwBDAFdiagAFACc+ACswAGNqADlw5nYuJBB+QWFRfMkEABY5fDYa2rra83LjMwQdLWV8BXLyuxlVLU1Ld090bzxCEnJKYLComODMeLS0PniTXLFCoUwRMTK7fC1zNql7NgUjtnKjU0RlBSqpLVUVPVUda60tYZAvHHG-FNAgBVbBCKjIEywNBMDb5LbFPaILqdfRSORsS4qcxXZqIHqyK6qY4XOxsGTKco-P4+Cb+aYAIXCsDAVFBQjhvAE212pWkskUKnUml0+gUNxaqkU+EccnKF1UCnucnMcjcHl+o3+vkmZBofCgUFIMwARpEoFRYuFsGBiJyCtzEXzWrJlGxlKdVFKvfY1XiEBjyvhVOVzBdzu13pYFNStbTAQFqAB5bAmvjheIQf4QtDhNCRWD2hE7EqgfayHTEh7lHQNSxSf1Scz4cpHHFyFVujTKczuDXYPgQOBiGl4TaOktIhAAWg6X3nC4Xp39050sYw2rpYHHRUnztVhPJqmUlIGbEriv9WhrLZ6uibHcqUr7riAA */
    id: 'Settings',
    predictableActionArguments: true,
    context: {
      baseUnit: 'in' as BaseUnit,
      cameraControls: 'KittyCAD' as CADProgram,
      defaultDirectory: '',
      defaultProjectName: '',
      onboardingStatus: '',
      showDebugPanel: false,
      textWrapping: 'On' as 'On' | 'Off',
      theme: Themes.System,
      unitSystem: UnitSystem.Imperial,
    },
    initial: 'idle',
    states: {
      idle: {
        entry: ['setThemeClass'],
        on: {
          'Set Base Unit': {
            actions: [
              assign({ baseUnit: (_, event) => event.data.baseUnit }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Camera Controls': {
            actions: [
              assign({
                cameraControls: (_, event) => event.data.cameraControls,
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
          'Set Text Wrapping': {
            actions: [
              assign({
                textWrapping: (_, event) => event.data.textWrapping,
              }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Theme': {
            actions: [
              assign({
                theme: (_, event) => event.data.theme,
              }),
              'persistSettings',
              'toastSuccess',
              'setThemeClass',
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
        },
      },
    },
    tsTypes: {} as import('./settingsMachine.typegen').Typegen0,
    schema: {
      events: {} as
        | { type: 'Set Base Unit'; data: { baseUnit: BaseUnit } }
        | { type: 'Set Camera Controls'; data: { cameraControls: CADProgram } }
        | { type: 'Set Default Directory'; data: { defaultDirectory: string } }
        | {
            type: 'Set Default Project Name'
            data: { defaultProjectName: string }
          }
        | { type: 'Set Onboarding Status'; data: { onboardingStatus: string } }
        | { type: 'Set Text Wrapping'; data: { textWrapping: 'On' | 'Off' } }
        | { type: 'Set Theme'; data: { theme: Themes } }
        | {
            type: 'Set Unit System'
            data: { unitSystem: UnitSystem }
          }
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
      setThemeClass: (context, event) => {
        const currentTheme =
          event.type === 'Set Theme' ? event.data.theme : context.theme
        setThemeClass(
          currentTheme === Themes.System ? getSystemTheme() : currentTheme
        )
      },
    },
  }
)
