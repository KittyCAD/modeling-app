import { type CommandSetConfig } from '../commandTypes'
import {
  type BaseUnit,
  type Toggle,
  UnitSystem,
  baseUnitsUnion,
  SettingsPaths,
  SettingsLevel,
} from 'lib/settings/settingsTypes'
import { settingsMachine } from 'machines/settingsMachine'
import { type CameraSystem, cameraSystems } from '../cameraControls'
import { Themes } from '../theme'
import { PathValue } from 'lib/types'

// SETTINGS MACHINE
export type SettingsCommandSchema<T extends SettingsPaths = SettingsPaths> = {
  [K in `set.${SettingsPaths}`]: {
    level: SettingsLevel
    value: PathValue<typeof settingsMachine.context, T>['default']
  }
}

const levelArgConfig = {
  inputType: 'options' as const,
  required: true,
  defaultValue: 'user' as SettingsLevel,
  options: [
    { name: 'User', value: 'user' as SettingsLevel, isCurrent: true },
    { name: 'Project', value: 'project' as SettingsLevel },
  ],
}

export const settingsCommandBarConfig: CommandSetConfig<
  typeof settingsMachine,
  SettingsCommandSchema
> = {
  'set.modeling.defaultUnit': {
    icon: 'settings',
    args: {
      level: levelArgConfig,
      value: {
        inputType: 'options',
        required: true,
        defaultValueFromContext: (context) =>
          context.modeling.defaultUnit.current,
        options: [],
        optionsFromContext: (context) =>
          Object.values(baseUnitsUnion).map((v) => ({
            name: v,
            value: v,
            isCurrent: v === context.modeling.defaultUnit.current,
          })),
      },
    },
  },
  'set.modeling.mouseControls': {
    icon: 'settings',
    args: {
      level: levelArgConfig,
      value: {
        inputType: 'options',
        required: true,
        defaultValueFromContext: (context) =>
          context.modeling.mouseControls.current,
        options: [],
        optionsFromContext: (context) =>
          Object.values(cameraSystems).map((v) => ({
            name: v,
            value: v,
            isCurrent: v === context.modeling.mouseControls.current,
          })),
      },
    },
  },
  'set.project.defaultProjectName': {
    icon: 'settings',
    hide: 'web',
    args: {
      level: levelArgConfig,
      value: {
        inputType: 'string',
        required: true,
        defaultValueFromContext: (context) =>
          context.project.defaultProjectName.current,
      },
    },
  },
  'set.textEditor.textWrapping': {
    icon: 'settings',
    args: {
      level: levelArgConfig,
      value: {
        inputType: 'options',
        required: true,
        defaultValueFromContext: (context) =>
          context.textEditor.textWrapping.current,
        options: [],
        optionsFromContext: (context) => [
          {
            name: 'On',
            value: 'On' as Toggle,
            isCurrent: context.textEditor.textWrapping.current === 'On',
          },
          {
            name: 'Off',
            value: 'Off' as Toggle,
            isCurrent: context.textEditor.textWrapping.current === 'Off',
          },
        ],
      },
    },
  },
  'set.app.theme': {
    icon: 'settings',
    args: {
      level: levelArgConfig,
      value: {
        inputType: 'options',
        required: true,
        defaultValueFromContext: (context) => context.app.theme.current,
        options: [],
        optionsFromContext: (context) =>
          Object.values(Themes).map((v) => ({
            name: v,
            value: v,
            isCurrent: v === context.app.theme.current,
          })),
      },
    },
  },
}
