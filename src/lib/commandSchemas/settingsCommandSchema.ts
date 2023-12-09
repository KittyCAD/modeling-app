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
        defaultValue: (context) => context.baseUnit,
        options: Object.values(baseUnitsUnion).map((v) => ({
          name: v,
          value: v,
        })),
      },
    },
  },
  'Set Camera Controls': {
    icon: 'gear',
    args: {
      cameraControls: {
        inputType: 'options',
        defaultValue: (context) => context.cameraControls,
        options: Object.values(cameraSystems).map((v) => ({
          name: v,
          value: v,
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
        defaultValue: (context) => context.defaultProjectName,
      },
    },
  },
  'Set Text Wrapping': {
    icon: 'gear',
    args: {
      textWrapping: {
        inputType: 'options',
        defaultValue: (context) => context.textWrapping,
        options: [
          { name: 'On', value: 'On' as Toggle },
          { name: 'Off', value: 'Off' as Toggle },
        ],
      },
    },
  },
  'Set Theme': {
    icon: 'gear',
    args: {
      theme: {
        inputType: 'options',
        defaultValue: (context) => context.theme,
        options: Object.values(Themes).map((v) => ({
          name: v,
          value: v,
        })),
      },
    },
  },
  'Set Unit System': {
    icon: 'gear',
    args: {
      unitSystem: {
        inputType: 'options',
        defaultValue: (context) => context.unitSystem,
        options: [
          { name: 'Imperial', value: 'imperial' as UnitSystem },
          { name: 'Metric', value: 'metric' as UnitSystem },
        ],
      },
    },
  },
}
