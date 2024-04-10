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
import { AnyStateMachine, ContextFrom, InterpreterFrom } from 'xstate'
import { getPropertyByPath } from 'lib/objectPropertyByPath'
import { buildCommandArgument } from 'lib/createMachineCommand'
import decamelize from 'decamelize'
import { isTauri } from 'lib/isTauri'

// An array of the paths to all of the settings that have commandConfigs
export const settingsWithCommandConfigs = (
  s: ContextFrom<typeof settingsMachine>
) =>
  Object.entries(s).flatMap(([categoryName, categorySettings]) =>
    Object.entries(categorySettings)
      .filter(([_, setting]) => setting.commandConfig !== undefined)
      .map(([settingName]) => `${categoryName}.${settingName}`)
  ) as SettingsPaths[]

const levelArgConfig = <T extends AnyStateMachine = AnyStateMachine>(
  actor: InterpreterFrom<T>,
  isProjectAvailable: boolean,
  hideOnLevel?: SettingsLevel
): CommandArgument<SettingsLevel, T> => ({
  inputType: 'options' as const,
  required: true,
  defaultValue:
    isProjectAvailable && hideOnLevel !== 'project' ? 'project' : 'user',
  skip: true,
  options:
    isProjectAvailable && hideOnLevel !== 'project'
      ? [
          { name: 'User', value: 'user' as SettingsLevel },
          {
            name: 'Project',
            value: 'project' as SettingsLevel,
            isCurrent: true,
          },
        ]
      : [{ name: 'User', value: 'user' as SettingsLevel, isCurrent: true }],
  machineActor: actor,
})

interface CreateSettingsArgs {
  type: SettingsPaths
  send: Function
  context: ContextFrom<typeof settingsMachine>
  actor: InterpreterFrom<typeof settingsMachine>
  isProjectAvailable: boolean
}

// Takes a Setting with a commandConfig and creates a Command
// that can be used in the CommandBar component.
export function createSettingsCommand({
  type,
  send,
  context,
  actor,
  isProjectAvailable,
}: CreateSettingsArgs) {
  type S = PathValue<typeof context, typeof type>

  const settingConfig = getPropertyByPath(context, type) as SettingProps<
    S['default']
  >
  const valueArgPartialConfig = settingConfig['commandConfig']
  const shouldHideOnThisLevel =
    settingConfig?.hideOnLevel === 'user' && !isProjectAvailable
  const shouldHideOnThisPlatform =
    settingConfig.hideOnPlatform &&
    (isTauri()
      ? settingConfig.hideOnPlatform === 'desktop'
      : settingConfig.hideOnPlatform === 'web')
  if (
    !valueArgPartialConfig ||
    shouldHideOnThisLevel ||
    shouldHideOnThisPlatform
  )
    return null

  const valueArgConfig = {
    ...valueArgPartialConfig,
    required: true,
  } as CommandArgumentConfig<S['default']>

  // @ts-ignore - TODO figure out this typing for valueArgConfig
  const valueArg = buildCommandArgument(valueArgConfig, context, actor)

  const command: Command = {
    name: type,
    displayName: `Settings · ${decamelize(type.replaceAll('.', ' · '), {
      separator: ' ',
    })}`,
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
      level: levelArgConfig(
        actor,
        isProjectAvailable,
        settingConfig.hideOnLevel
      ),
      value: valueArg,
    },
  }

  return command
}
