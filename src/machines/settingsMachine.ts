import { assign, createMachine } from 'xstate'
import { Themes, getSystemTheme, setThemeClass } from 'lib/theme'
import { CameraSystem } from 'lib/cameraControls'
import { isTauri } from 'lib/isTauri'
import { writeToSettingsFiles } from 'lib/tauriFS'
import { SETTINGS_PERSIST_KEY } from 'lib/constants'
import {
  UnitSystem,
  type BaseUnit,
  type SettingsMachineContext,
  type Toggle,
  SettingsLevel,
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
                baseUnit: (context, event) => ({
                  ...context.baseUnit,
                  [event.data.level]: event.data.baseUnit,
                }),
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
                cameraControls: (context, event) => ({
                  ...context.cameraControls,
                  [event.data.level]: event.data.cameraControls,
                }),
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
                defaultDirectory: (context, event) => ({
                  ...context.defaultDirectory,
                  [event.data.level]: event.data.defaultDirectory,
                }),
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
                defaultProjectName: (context, event) => ({
                  ...context.defaultProjectName,
                  [event.data.level]: event.data.defaultProjectName,
                }),
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
                onboardingStatus: (context, event) => ({
                  ...context.onboardingStatus,
                  [event.data.level]: event.data.onboardingStatus,
                }),
              }),
              'persistSettings',
            ],
            target: 'idle',
            internal: true,
          },
          'Set Text Wrapping': {
            actions: [
              assign({
                textWrapping: (context, event) => ({
                  ...context.textWrapping,
                  [event.data.level]: event.data.textWrapping,
                }),
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
                theme: (context, event) => ({
                  ...context.theme,
                  [event.data.level]: event.data.theme,
                }),
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
                unitSystem: (context, event) => ({
                  ...context.unitSystem,
                  [event.data.level]: event.data.unitSystem,
                }),
                baseUnit: (context, event) => ({
                  ...context.baseUnit,
                  [event.data.level]:
                    event.data.unitSystem === 'imperial' ? 'in' : 'mm',
                }),
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
                showDebugPanel: (context, event) => ({
                  ...context.showDebugPanel,
                  [event.data.level]: !context.showDebugPanel[event.data.level],
                }),
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
        | {
            type: 'Set Base Unit'
            data: { baseUnit: BaseUnit; level: SettingsLevel }
          }
        | {
            type: 'Set Camera Controls'
            data: { cameraControls: CameraSystem; level: SettingsLevel }
          }
        | {
            type: 'Set Default Directory'
            data: { defaultDirectory: string; level: SettingsLevel }
          }
        | {
            type: 'Set Default Project Name'
            data: { defaultProjectName: string; level: SettingsLevel }
          }
        | {
            type: 'Set Onboarding Status'
            data: { onboardingStatus: string; level: SettingsLevel }
          }
        | {
            type: 'Set Text Wrapping'
            data: { textWrapping: Toggle; level: SettingsLevel }
          }
        | { type: 'Set Theme'; data: { theme: Themes; level: SettingsLevel } }
        | {
            type: 'Set Unit System'
            data: { unitSystem: UnitSystem; level: SettingsLevel }
          }
        | { type: 'Toggle Debug Panel'; data: { level: SettingsLevel } },
    },
  },
  {
    actions: {
      persistSettings: (context) => {
        if (isTauri()) {
          writeToSettingsFiles(context).catch((err) => {
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
          event.type === 'Set Theme'
            ? event.data.theme
            : context.theme.current()
        setThemeClass(
          currentTheme === Themes.System ? getSystemTheme() : currentTheme
        )
      },
    },
  }
)
