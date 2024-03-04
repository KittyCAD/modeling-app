import { CommandSetConfig } from '../commandTypes'
import {
  BaseUnit,
  Toggle,
  UnitSystem,
  baseUnitsUnion,
  settingsMachine,
} from 'machines/settingsMachine'
import { CameraSystem, cameraSystems } from '../cameraControls'
import { Themes } from '../theme'

// SETTINGS MACHINE
export type SettingsCommandSchema = {
  'Set Base Unit': {
    baseUnit: BaseUnit
  }
  'Set Camera Controls': {
    cameraControls: CameraSystem
  }
  'Set Default Project Name': {
    defaultProjectName: string
  }
  'Set Text Wrapping': {
    textWrapping: Toggle
  }
  'Set Theme': {
    theme: Themes
  }
  'Set Unit System': {
    unitSystem: UnitSystem
  }
}

export const settingsCommandBarConfig: CommandSetConfig<
  typeof settingsMachine,
  SettingsCommandSchema
> = {
  'Set Base Unit': {
    icon: 'settings',
    args: {
      baseUnit: {
        inputType: 'options',
        required: true,
        defaultValueFromContext: (context) => context.baseUnit,
        options: [],
        optionsFromContext: (context) =>
          Object.values(baseUnitsUnion).map((v) => ({
            name: v,
            value: v,
            isCurrent: v === context.baseUnit,
          })),
      },
    },
  },
  'Set Camera Controls': {
    icon: 'settings',
    args: {
      cameraControls: {
        inputType: 'options',
        required: true,
        defaultValueFromContext: (context) => context.cameraControls,
        options: [],
        optionsFromContext: (context) =>
          Object.values(cameraSystems).map((v) => ({
            name: v,
            value: v,
            isCurrent: v === context.cameraControls,
          })),
      },
    },
  },
  'Set Default Project Name': {
    icon: 'settings',
    hide: 'web',
    args: {
      defaultProjectName: {
        inputType: 'string',
        required: true,
        defaultValueFromContext: (context) => context.defaultProjectName,
      },
    },
  },
  'Set Text Wrapping': {
    icon: 'settings',
    args: {
      textWrapping: {
        inputType: 'options',
        required: true,
        defaultValueFromContext: (context) => context.textWrapping,
        options: [],
        optionsFromContext: (context) => [
          {
            name: 'On',
            value: 'On' as Toggle,
            isCurrent: context.textWrapping === 'On',
          },
          {
            name: 'Off',
            value: 'Off' as Toggle,
            isCurrent: context.textWrapping === 'Off',
          },
        ],
      },
    },
  },
  'Set Theme': {
    icon: 'settings',
    args: {
      theme: {
        inputType: 'options',
        required: true,
        defaultValueFromContext: (context) => context.theme,
        options: [],
        optionsFromContext: (context) =>
          Object.values(Themes).map((v) => ({
            name: v,
            value: v,
            isCurrent: v === context.theme,
          })),
      },
    },
  },
  'Set Unit System': {
    icon: 'settings',
    args: {
      unitSystem: {
        inputType: 'options',
        required: true,
        defaultValueFromContext: (context) => context.unitSystem,
        options: [],
        optionsFromContext: (context) => [
          {
            name: 'Imperial',
            value: 'imperial' as UnitSystem,
            isCurrent: context.unitSystem === 'imperial',
          },
          {
            name: 'Metric',
            value: 'metric' as UnitSystem,
            isCurrent: context.unitSystem === 'metric',
          },
        ],
      },
    },
  },
}
