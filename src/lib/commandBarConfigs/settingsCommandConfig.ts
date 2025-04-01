import decamelize from 'decamelize'
import { buildCommandArgument } from 'lib/createMachineCommand'
import { isDesktop } from 'lib/isDesktop'
import { getPropertyByPath } from 'lib/objectPropertyByPath'
import {
  Setting,
  SettingsType,
  createSettings,
} from 'lib/settings/initialSettings'
import {
  SetEventTypes,
  SettingProps,
  SettingsLevel,
  SettingsPaths,
} from 'lib/settings/settingsTypes'
import { PathValue } from 'lib/types'
import { settingsMachine } from 'machines/settingsMachine'
import { ActorRefFrom, AnyStateMachine } from 'xstate'

import {
  Command,
  CommandArgument,
  CommandArgumentConfig,
} from '../commandTypes'

// An array of the paths to all of the settings that have commandConfigs
export const settingsWithCommandConfigs = (s: SettingsType) =>
  Object.entries(s).flatMap(([categoryName, categorySettings]) =>
    Object.entries(categorySettings)
      .filter(([_, setting]) => setting.commandConfig !== undefined)
      .map(([settingName]) => `${categoryName}.${settingName}`)
  ) as SettingsPaths[]

const levelArgConfig = <T extends AnyStateMachine = AnyStateMachine>(
  actor: ActorRefFrom<T>,
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
  actor: ActorRefFrom<typeof settingsMachine>
}

// Takes a Setting with a commandConfig and creates a Command
// that can be used in the CommandBar component.
export function createSettingsCommand({ type, actor }: CreateSettingsArgs) {
  type S = PathValue<ReturnType<typeof createSettings>, typeof type>

  const context = actor.getSnapshot().context
  const isProjectAvailable = context.currentProject !== undefined
  const settingConfig = getPropertyByPath(context, type) as SettingProps<
    S['default']
  >
  const valueArgPartialConfig = settingConfig['commandConfig']
  const shouldHideOnThisLevel =
    settingConfig?.hideOnLevel === 'user' && !isProjectAvailable
  const shouldHideOnThisPlatform =
    settingConfig.hideOnPlatform &&
    (isDesktop()
      ? settingConfig.hideOnPlatform === 'desktop'
      : settingConfig.hideOnPlatform === 'web')
  if (
    !valueArgPartialConfig ||
    shouldHideOnThisLevel ||
    shouldHideOnThisPlatform
  )
    return null

  let valueArgConfig = {
    ...valueArgPartialConfig,
    required: true,
  } as CommandArgumentConfig<S['default']>

  // If the setting is a boolean, we coerce it into an options input type
  if (valueArgConfig.inputType === 'boolean') {
    valueArgConfig = {
      ...valueArgConfig,
      inputType: 'options',
      options: (cmdBarContext, machineContext) => {
        const setting = getPropertyByPath(
          machineContext,
          type
        ) as Setting<boolean>
        const level = cmdBarContext.argumentsToSubmit.level as SettingsLevel
        const isCurrent =
          setting[level] === undefined
            ? setting.getFallback(level) === true
            : setting[level] === true
        return [
          { name: 'On', value: true, isCurrent },
          { name: 'Off', value: false, isCurrent: !isCurrent },
        ]
      },
    }
  }

  // @ts-ignore - TODO figure out this typing for valueArgConfig
  const valueArg = buildCommandArgument(valueArgConfig, context, actor)

  const command: Command = {
    name: type,
    displayName: `Settings · ${decamelize(type.replaceAll('.', ' · '), {
      separator: ' ',
    })}`,
    description: settingConfig.description,
    groupId: 'settings',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      if (
        data !== undefined &&
        data !== null &&
        'value' in data &&
        'level' in data
      ) {
        // TS would not let me get this to type properly
        const coercedData = data as unknown as SetEventTypes['data']
        actor.send({ type: `set.${type}`, data: coercedData })
      } else {
        console.error('Invalid data submitted to settings command', data)
        return new Error('Invalid data submitted to settings command', data)
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
