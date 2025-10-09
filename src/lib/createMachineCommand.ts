import type {
  Actor,
  AnyStateMachine,
  ContextFrom,
  EventFrom,
  StateFrom,
} from 'xstate'

import type {
  Command,
  CommandArgument,
  CommandArgumentConfig,
  CommandConfig,
  StateMachineCommandSetConfig,
  StateMachineCommandSetSchema,
} from '@src/lib/commandTypes'
import { isDesktop } from '@src/lib/isDesktop'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

interface CreateMachineCommandProps<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
> {
  type: EventFrom<T>['type']
  groupId: T['id']
  state: StateFrom<T>
  send: Function
  actor: Actor<T>
  commandBarConfig?: StateMachineCommandSetConfig<T, S>
  onCancel?: () => void
  forceDisable?: boolean
}

// Creates a command with subcommands, ready for use in the CommandBar component,
// from a more terse Command Bar Meta definition.
export function createMachineCommand<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
>({
  groupId,
  type,
  state,
  send,
  actor,
  commandBarConfig,
  onCancel,
  forceDisable = false,
}: CreateMachineCommandProps<T, S>):
  | Command<T, typeof type, S[typeof type]>
  | Command<T, typeof type, S[typeof type]>[]
  | null {
  const commandConfig = commandBarConfig && commandBarConfig[type]

  // There may be no command config for this event type,
  // or the command may be inactive or hidden,
  // or there may be multiple commands to create.
  if (!commandConfig) {
    return null
  } else if (commandConfig instanceof Array) {
    return commandConfig
      .map((config) => {
        const recursiveCommandBarConfig: Partial<
          StateMachineCommandSetConfig<T, S>
        > = {
          [type]: config,
        }
        return createMachineCommand({
          groupId,
          type,
          state,
          send,
          actor,
          commandBarConfig: recursiveCommandBarConfig,
          onCancel,
          forceDisable,
        })
      })
      .filter((c) => c !== null) as Command<T, typeof type, S[typeof type]>[]
  }

  // Hide commands based on platform or development status by returning `null`
  // so the consumer can filter them out
  if ('hide' in commandConfig) {
    const { hide } = commandConfig
    if (hide === 'both') return null
    else if (hide === 'desktop' && isDesktop()) return null
    else if (hide === 'web' && !isDesktop()) return null
  } else if ('status' in commandConfig) {
    const { status } = commandConfig
    if (status === 'inactive') return null
    if (status === 'development' && !IS_STAGING_OR_DEBUG) return null
  }

  const icon = ('icon' in commandConfig && commandConfig.icon) || undefined

  const command: Command<T, typeof type, S[typeof type]> = {
    name: type,
    groupId,
    icon,
    description: commandConfig.description,
    needsReview: commandConfig.needsReview || false,
    machineActor: actor,
    onSubmit: (data?: S[typeof type]) => {
      if (data !== undefined && data !== null) {
        send({ type, data })
      } else {
        send({ type })
      }
    },
    disabled: forceDisable,
  }

  if (commandConfig.args) {
    const newArgs = buildCommandArguments(state, commandConfig.args, actor)

    command.args = newArgs
  }

  if (onCancel) {
    command.onCancel = onCancel
  }

  if ('displayName' in commandConfig) {
    command.displayName = commandConfig.displayName
  }
  if ('reviewMessage' in commandConfig) {
    command.reviewMessage = commandConfig.reviewMessage
  }
  if ('status' in commandConfig) {
    command.status = commandConfig.status
  }

  return command
}

// Takes the args from a CommandConfig and creates
// a finalized CommandArgument object for each one,
// bundled together into the args for a Command.
function buildCommandArguments<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
  CommandName extends EventFrom<T>['type'] = EventFrom<T>['type'],
>(
  state: StateFrom<T>,
  args: CommandConfig<T, CommandName, S>['args'],
  machineActor: Actor<T>
): NonNullable<Command<T, CommandName, S>['args']> {
  const newArgs = {} as NonNullable<Command<T, CommandName, S>['args']>

  for (const arg in args) {
    const argConfig = args[arg] as CommandArgumentConfig<S[typeof arg], T>
    const newArg = buildCommandArgument(argConfig, state.context, machineActor)
    newArgs[arg] = newArg
  }

  return newArgs
}

export function buildCommandArgument<
  T extends AnyStateMachine,
  O extends StateMachineCommandSetSchema<T> = StateMachineCommandSetSchema<T>,
>(
  arg: CommandArgumentConfig<O, T>,
  context: ContextFrom<T>,
  machineActor: Actor<T>
): CommandArgument<O, T> & { inputType: typeof arg.inputType } {
  // GOTCHA: modelingCommandConfig is not a 1:1 mapping to this baseCommandArgument
  // You need to manually add key/value pairs here.
  const baseCommandArgument = {
    displayName: arg.displayName,
    description: arg.description,
    required: arg.required,
    hidden: arg.hidden,
    skip: arg.skip,
    machineActor,
    valueSummary: arg.valueSummary,
  } satisfies Omit<CommandArgument<O, T>, 'inputType'>

  if (arg.inputType === 'options') {
    return {
      inputType: arg.inputType,
      ...baseCommandArgument,
      defaultValue: arg.defaultValueFromContext
        ? arg.defaultValueFromContext(context)
        : arg.defaultValue,
      options: arg.optionsFromContext
        ? arg.optionsFromContext(context)
        : arg.options,
    } satisfies CommandArgument<O, T> & { inputType: 'options' }
  } else if (arg.inputType === 'selection') {
    return {
      inputType: arg.inputType,
      ...baseCommandArgument,
      multiple: arg.multiple,
      selectionTypes: arg.selectionTypes,
      validation: arg.validation,
      clearSelectionFirst: arg.clearSelectionFirst,
      selectionFilter: arg.selectionFilter,
    } satisfies CommandArgument<O, T> & { inputType: 'selection' }
  } else if (arg.inputType === 'selectionMixed') {
    return {
      inputType: arg.inputType,
      ...baseCommandArgument,
      multiple: arg.multiple,
      selectionTypes: arg.selectionTypes,
      validation: arg.validation,
      clearSelectionFirst: arg.clearSelectionFirst,
      allowNoSelection: arg.allowNoSelection,
      selectionSource: arg.selectionSource,
      selectionFilter: arg.selectionFilter,
    } satisfies CommandArgument<O, T> & { inputType: 'selectionMixed' }
  } else if (arg.inputType === 'kcl') {
    return {
      inputType: arg.inputType,
      allowArrays: arg.allowArrays,
      createVariable: arg.createVariable,
      variableName: arg.variableName,
      defaultValue: arg.defaultValue,
      ...baseCommandArgument,
    } satisfies CommandArgument<O, T> & { inputType: 'kcl' }
  } else if (arg.inputType === 'vector3d') {
    return {
      inputType: arg.inputType,
      defaultValue: arg.defaultValue,
      validation: arg.validation,
      ...baseCommandArgument,
    } satisfies CommandArgument<O, T> & { inputType: 'vector3d' }
  } else if (arg.inputType === 'string') {
    return {
      inputType: arg.inputType,
      defaultValue: arg.defaultValueFromContext
        ? arg.defaultValueFromContext(context)
        : arg.defaultValue,
      validation: arg.validation,
      ...baseCommandArgument,
    } satisfies CommandArgument<O, T> & { inputType: 'string' }
  } else {
    return {
      inputType: arg.inputType,
      defaultValue: arg.defaultValueFromContext
        ? arg.defaultValueFromContext(context)
        : arg.defaultValue,
      ...baseCommandArgument,
    }
  }
}
