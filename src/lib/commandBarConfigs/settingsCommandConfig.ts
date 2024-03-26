import { Command, CommandArgumentConfig } from '../commandTypes'
import {
  SettingsPaths,
  SettingsLevel,
  SettingProps,
} from 'lib/settings/settingsTypes'
import { settingsMachine } from 'machines/settingsMachine'
import { PathValue } from 'lib/types'
import { settings } from 'lib/settings/initialSettings'
import { AnyStateMachine, InterpreterFrom } from 'xstate'
import { getPropertyByPath } from 'lib/objectPropertyByPath'
import { buildCommandArgument } from 'lib/createMachineCommand'

// SETTINGS MACHINE
export type SettingsCommandSchema<T extends SettingsPaths = SettingsPaths> = {
  [K in `set.${SettingsPaths}`]: {
    level: SettingsLevel
    value: PathValue<typeof settings, T>['default']
  }
}

const levelArgConfig = (actor: InterpreterFrom<AnyStateMachine>) => ({
  inputType: 'options' as const,
  required: true,
  defaultValue: 'user' as SettingsLevel,
  options: [
    { name: 'User', value: 'user' as SettingsLevel, isCurrent: true },
    { name: 'Project', value: 'project' as SettingsLevel },
  ],
  machineActor: actor,
})

// Takes a Setting with a commandConfig and creates a Command
// that can be used in the CommandBar component.
export function createSettingsCommand(
  type: SettingsPaths,
  send: Function,
  actor: InterpreterFrom<typeof settingsMachine>
) {
  type S = PathValue<typeof settings, typeof type>

  const valueArgPartialConfig = (getPropertyByPath(settings, type) as SettingProps<S['default']>)['commandConfig']
  if (!valueArgPartialConfig) return null

  const valueArgConfig = {
    ...valueArgPartialConfig,
    required: true,
  } as CommandArgumentConfig<S['default']>

  // @ts-ignore - TODO figure out this typing for valueArgConfig
  const valueArg = buildCommandArgument(valueArgConfig, settings, actor)
  
  console.log('valueArg', valueArg)

  const command: Command = {
    name: type,
    ownerMachine: 'settings',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      if (data !== undefined && data !== null) {
        send({ type: `set.${type}`, data })
      } else {
        send(type)
      }
    },
    args: {
      level: levelArgConfig(actor),
      value: valueArg,
    }
  }

  return command
}