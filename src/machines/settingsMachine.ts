import { assign, createMachine } from 'xstate'
import { Themes, getSystemTheme, setThemeClass } from '../lib/theme'
import { CameraSystem } from 'lib/cameraControls'
import { Models } from '@kittycad/lib'

export const DEFAULT_PROJECT_NAME = 'project-$nnn'

export enum UnitSystem {
  Imperial = 'imperial',
  Metric = 'metric',
}

export const baseUnits = {
  imperial: ['in', 'ft', 'yd'],
  metric: ['mm', 'cm', 'm'],
} as const

export type BaseUnit = Models['UnitLength_type']

export const baseUnitsUnion = Object.values(baseUnits).flatMap((v) => v)

export type Toggle = 'On' | 'Off'

export const SETTINGS_PERSIST_KEY = 'SETTINGS_PERSIST_KEY'

export const settingsMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlTQAIAVACzAFswBtABgF1FQAHAe1iYsfbNxAAPRAA42+AEwB2KQFYAzGznKAnADZli1QBoQAT2kBGKfm37lOned3nzqgL6vjlLLgJFSFdCoAETAAMwBDAFdiagAFACc+ACswAGNqADlw5nYuJBB+QWFRfMkEABY5fDYa2rra83LjMwQdLWV8BXLyuxlVLU1Ld090bzxCEnJKYLComODMeLS0PniTXLFCoUwRMTK7fC1zNql7NgUjtnKjU0RlBSqpLVUVPVUda60tYZAvHHG-FNAgBVbBCKjIEywNBMDb5LbFPaILqdfRSORsS4qcxXZqIHqyK6qY4XOxsGTKco-P4+Cb+aYAIXCsDAVFBQjhvAE212pWkskUKnUml0+gUNxaqkU+EccnKF1UCnucnMcjcHl+o3+vkmZBofCgUFIMwARpEoFRYuFsGBiJyCtzEXzWrJlGxlKdVFKvfY1XiEBjyvhVOVzBdzu13pYFNStbTAQFqAB5bAmvjheIQf4QtDhNCRWD2hE7EqgfayHTEh7lHQNSxSf1Scz4cpHHFyFVujTKczuDXYPgQOBiGl4TaOktIhAAWg6X3nC4Xp39050sYw2rpYHHRUnztVhPJqmUlIGbEriv9WhrLZ6uibHcqUr7riAA */
    id: 'Settings',
    context: {
      baseUnit: 'in' as BaseUnit,
      cameraControls: 'KittyCAD' as CameraSystem,
      defaultDirectory: '',
      defaultProjectName: DEFAULT_PROJECT_NAME,
      onboardingStatus: '',
      showDebugPanel: false,
      textWrapping: 'On' as Toggle,
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
              assign({
                baseUnit: ({ event }) => {
                  console.log('event', event)
                  return event.data.baseUnit
                },
              }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            reenter: false,
          },
          'Set Camera Controls': {
            actions: [
              assign({
                cameraControls: ({ event }) => event.data.cameraControls,
              }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            reenter: false,
          },
          'Set Default Directory': {
            actions: [
              assign({
                defaultDirectory: ({ event }) => event.data.defaultDirectory,
              }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            reenter: false,
          },
          'Set Default Project Name': {
            actions: [
              assign({
                defaultProjectName: ({ event }) =>
                  event.data.defaultProjectName.trim() || DEFAULT_PROJECT_NAME,
              }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            reenter: false,
          },
          'Set Onboarding Status': {
            actions: [
              assign({
                onboardingStatus: ({ event }) => event.data.onboardingStatus,
              }),
              'persistSettings',
            ],
            target: 'idle',
            reenter: false,
          },
          'Set Text Wrapping': {
            actions: [
              assign({
                textWrapping: ({ event }) => event.data.textWrapping,
              }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            reenter: false,
          },
          'Set Theme': {
            actions: [
              assign({
                theme: ({ event }) => event.data.theme,
              }),
              'persistSettings',
              'toastSuccess',
              'setThemeClass',
            ],
            target: 'idle',
            reenter: false,
          },
          'Set Unit System': {
            actions: [
              assign({
                unitSystem: ({ event }) => event.data.unitSystem,
                baseUnit: ({ event }) =>
                  event.data.unitSystem === 'imperial' ? 'in' : 'mm',
              }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            reenter: false,
          },
          'Toggle Debug Panel': {
            actions: [
              assign({
                showDebugPanel: ({ context }) => {
                  return !context.showDebugPanel
                },
              }),
              'persistSettings',
              'toastSuccess',
            ],
            target: 'idle',
            reenter: false,
          },
        },
      },
    },
    tsTypes: {} as import('./settingsMachine.typegen').Typegen0,
    types: {
      events: {} as
        | { type: 'Set Base Unit'; data: { baseUnit: BaseUnit } }
        | {
            type: 'Set Camera Controls'
            data: { cameraControls: CameraSystem }
          }
        | { type: 'Set Default Directory'; data: { defaultDirectory: string } }
        | {
            type: 'Set Default Project Name'
            data: { defaultProjectName: string }
          }
        | { type: 'Set Onboarding Status'; data: { onboardingStatus: string } }
        | { type: 'Set Text Wrapping'; data: { textWrapping: Toggle } }
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
      setThemeClass: ({ context, event }) => {
        const currentTheme =
          event.type === 'Set Theme' ? event.data.theme : context.theme
        setThemeClass(
          currentTheme === Themes.System ? getSystemTheme() : currentTheme
        )
      },
    },
  }
)
