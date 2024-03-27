import {
  Command,
  CommandArgument,
  CommandArgumentConfig,
} from '../commandTypes'
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

// An array of the paths to all of the settings that have commandConfigs
export const settingsWithCommandConfigs = Object.entries(settings).flatMap(
  ([categoryName, categorySettings]) =>
    Object.entries(categorySettings)
      .filter(([_, setting]) => setting.commandConfig !== undefined)
      .map(([settingName]) => `${categoryName}.${settingName}`)
) as SettingsPaths[]

const levelArgConfig = <T extends AnyStateMachine = AnyStateMachine>(
  actor: InterpreterFrom<T>,
  isProjectAvailable: boolean
): CommandArgument<SettingsLevel, T> => ({
  inputType: 'options' as const,
  required: true,
  defaultValue: isProjectAvailable ? 'project' : 'user',
  skip: true,
  options: isProjectAvailable
    ? [
        { name: 'User', value: 'user' as SettingsLevel },
        { name: 'Project', value: 'project' as SettingsLevel, isCurrent: true },
      ]
    : [{ name: 'User', value: 'user' as SettingsLevel, isCurrent: true }],
  machineActor: actor,
})

// Takes a Setting with a commandConfig and creates a Command
// that can be used in the CommandBar component.
export function createSettingsCommand(
  type: SettingsPaths,
  send: Function,
  actor: InterpreterFrom<typeof settingsMachine>,
  isProjectAvailable: boolean
) {
  type S = PathValue<typeof settings, typeof type>

  const settingConfig = getPropertyByPath(settings, type) as SettingProps<
    S['default']
  >
  const valueArgPartialConfig = settingConfig['commandConfig']
  const shouldHideOnThisLevel = isProjectAvailable
    ? settingConfig.hideOnLevel === 'project'
    : settingConfig.hideOnLevel === 'user'
  if (!valueArgPartialConfig || shouldHideOnThisLevel) return null

  const valueArgConfig = {
    ...valueArgPartialConfig,
    required: true,
  } as CommandArgumentConfig<S['default']>

  // @ts-ignore - TODO figure out this typing for valueArgConfig
  const valueArg = buildCommandArgument(valueArgConfig, settings, actor)

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
      level: levelArgConfig(actor, isProjectAvailable),
      value: valueArg,
    },
  }

  return command
}
