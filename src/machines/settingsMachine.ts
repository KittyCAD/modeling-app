import { assign, createMachine } from 'xstate'
import { Themes, getSystemTheme, setThemeClass } from 'lib/theme'
import { CameraSystem } from 'lib/cameraControls'
import { isTauri } from 'lib/isTauri'
import { writeToSettingsFile } from 'lib/tauriFS'
import { DEFAULT_PROJECT_NAME, SETTINGS_PERSIST_KEY } from 'lib/constants'
import {
  UnitSystem,
  type BaseUnit,
  type SettingsMachineContext,
  type Toggle,
} from 'lib/settings/settingsTypes'

export const settingsMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlTQAIBBY4qyrXWAbQAYBdRUABwHtYmLP2w8QAD0TsANCACe0gL5K5THHkIlylKgCEAhrDBUAqtmEduSEAKEixNqQgCM7AJz52AJgAsAVg8AZgAOEIA2fxd3XzlFBCCXf3xfdlS0kN9vGIiVNXRmTSJSCnQqAGEDAFswACcDCtE0Wv5iNi5xO2FMUXFnWQVlVRB1Fi0S3QARMAAzAwBXYmpJzFqwAGM0flr5K07Bbt6nRH9w-HcXcPcI8PYAdgu0oLiTu+98EPdQ0-8g8N8gu53HkRgUNARijoytM5otqAAFFoAKw21AActUwHsbF0HH1EFkvOxiSTScSXLFBggrsk7r4AuEQuxAd4oiEQaMitpStQAPLYABG-AMtQgGkYaAMaHm7WsfAOeOOCEC+HCiTevlu5JcYReCBCLhSFzc3m8SWJrJcHLBY0hPKoABUwBJqAB1eq8XgabHy+w9Rygfp69jWjDg8ZQ6gOgAWYBqPtsCv9+P17Hw3juIV+Pn87kiGeeVINIXwuf8rPC4WiVZcQVDhQh3N05mEjHksDQcYTuOTSrp+Du5ZC3g8bizbkp8QCaaelwep3YTP8vnr4btDv4UCgpCo0wF8ygVHhBmwYGI3aTR0DiFupfY-giQSC3iflZfepHvnwQV8Lge93cX4qxCO4VGGbB+AgOBxE5eAcUvANJEQABaXwQj1ZCQLvUkmXpFwzStYZYIjfY-SvJDXBHLxa01Stc0yIE7j1NwKW-NUAl8a4-DuZkwKUIA */
    id: 'Settings',
    predictableActionArguments: true,
    context: {} as SettingsMachineContext,
    initial: 'idle',
    states: {
      idle: {
        entry: ['setThemeClass', 'setClientSideSceneUnits', 'persistSettings'],
        on: {
          'Set All Settings': {
            actions: [
              assign((context, event) => {
                return {
                  ...context,
                  ...event.data,
                }
              }),
              'persistSettings',
              'setThemeClass',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Base Unit': {
            actions: [
              assign({
                baseUnit: (_, event) => event.data.baseUnit,
              }),
              'persistSettings',
              'toastSuccess',
              'setClientSideSceneUnits',
              'Execute AST',
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
                defaultProjectName: (_, event) =>
                  event.data.defaultProjectName.trim() || DEFAULT_PROJECT_NAME,
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
              'Execute AST',
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
        | { type: 'Set All Settings'; data: Partial<SettingsMachineContext> }
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
        if (isTauri()) {
          writeToSettingsFile(context).catch((err) => {
            console.error('Error writing settings:', err)
          })
        }
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
