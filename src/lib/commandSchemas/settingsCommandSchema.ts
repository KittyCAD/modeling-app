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
export type SettingsCommandArgs = {
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
  SettingsCommandArgs
> = {
  'Set Base Unit': {
    icon: 'gear',
    args: {
      baseUnit: {
        inputType: 'options',
        required: true,
        defaultValue: (context) => context.baseUnit,
        options: (context) =>
          Object.values(baseUnitsUnion).map((v) => ({
            name: v,
            value: v,
            isCurrent: v === context.baseUnit,
          })),
      },
    },
  },
  'Set Camera Controls': {
    icon: 'gear',
    args: {
      cameraControls: {
        inputType: 'options',
        required: true,
        defaultValue: (context) => context.cameraControls,
        options: (context) =>
          Object.values(cameraSystems).map((v) => ({
            name: v,
            value: v,
            isCurrent: v === context.cameraControls,
          })),
      },
    },
  },
  'Set Default Project Name': {
    icon: 'gear',
    hide: 'web',
    args: {
      defaultProjectName: {
        inputType: 'string',
        required: true,
        defaultValue: (context) => context.defaultProjectName,
      },
    },
  },
  'Set Text Wrapping': {
    icon: 'gear',
    args: {
      textWrapping: {
        inputType: 'options',
        required: true,
        defaultValue: (context) => context.textWrapping,
        options: (context) => [
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
    icon: 'gear',
    args: {
      theme: {
        inputType: 'options',
        required: true,
        defaultValue: (context) => context.theme,
        options: (context) =>
          Object.values(Themes).map((v) => ({
            name: v,
            value: v,
            isCurrent: v === context.theme,
          })),
      },
    },
  },
  'Set Unit System': {
    icon: 'gear',
    args: {
      unitSystem: {
        inputType: 'options',
        required: true,
        defaultValue: (context) => context.unitSystem,
        options: (context) => [
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
