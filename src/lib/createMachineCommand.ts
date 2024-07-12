import {
  AnyStateMachine,
  ContextFrom,
  EventFrom,
  InterpreterFrom,
  StateFrom,
} from 'xstate'
import { isTauri } from './isTauri'
import {
  Command,
  CommandArgument,
  CommandArgumentConfig,
  CommandConfig,
  StateMachineCommandSetConfig,
  StateMachineCommandSetSchema,
} from './commandTypes'

interface CreateMachineCommandProps<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>
> {
  type: EventFrom<T>['type']
  groupId: T['id']
  state: StateFrom<T>
  send: Function
  actor: InterpreterFrom<T>
  commandBarConfig?: StateMachineCommandSetConfig<T, S>
  onCancel?: () => void
}

// Creates a command with subcommands, ready for use in the CommandBar component,
// from a more terse Command Bar Meta definition.
export function createMachineCommand<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>
>({
  groupId,
  type,
  state,
  send,
  actor,
  commandBarConfig,
  onCancel,
}: CreateMachineCommandProps<T, S>):
  | Command<T, typeof type, S[typeof type]>
  | Command<T, typeof type, S[typeof type]>[]
  | null {
  const commandConfig = commandBarConfig && commandBarConfig[type]
  // There may be no command config for this event type,
  // or there may be multiple commands to create.
  if (!commandConfig) {
    return null
  } else if (commandConfig instanceof Array) {
    return commandConfig
      .map((config) =>
        createMachineCommand({
          groupId,
          type,
          state,
          send,
          actor,
          commandBarConfig: { [type]: config },
          onCancel,
        })
      )
      .filter((c) => c !== null) as Command<T, typeof type, S[typeof type]>[]
  }

  // Hide commands based on platform by returning `null`
  // so the consumer can filter them out
  if ('hide' in commandConfig) {
    const { hide } = commandConfig
    if (hide === 'both') return null
    else if (hide === 'desktop' && isTauri()) return null
    else if (hide === 'web' && !isTauri()) return null
  }

  const icon = ('icon' in commandConfig && commandConfig.icon) || undefined

  const command: Command<T, typeof type, S[typeof type]> = {
    name: type,
    groupId,
    icon,
    needsReview: commandConfig.needsReview || false,
    onSubmit: (data?: S[typeof type]) => {
      if (data !== undefined && data !== null) {
        send(type, { data })
      } else {
        send(type)
      }
    },
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

  return command
}

// Takes the args from a CommandConfig and creates
// a finalized CommandArgument object for each one,
// bundled together into the args for a Command.
function buildCommandArguments<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
  CommandName extends EventFrom<T>['type'] = EventFrom<T>['type']
>(
  state: StateFrom<T>,
  args: CommandConfig<T, CommandName, S>['args'],
  machineActor: InterpreterFrom<T>
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
  O extends StateMachineCommandSetSchema<T> = StateMachineCommandSetSchema<T>
>(
  arg: CommandArgumentConfig<O, T>,
  context: ContextFrom<T>,
  machineActor: InterpreterFrom<T>
): CommandArgument<O, T> & { inputType: typeof arg.inputType } {
  const baseCommandArgument = {
    description: arg.description,
    required: arg.required,
    skip: arg.skip,
    machineActor,
  } satisfies Omit<CommandArgument<O, T>, 'inputType'>

  if (arg.inputType === 'options') {
    if (!(arg.options || arg.optionsFromContext)) {
      throw new Error('Options must be provided for options input type')
    }

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
    } satisfies CommandArgument<O, T> & { inputType: 'selection' }
  } else if (arg.inputType === 'kcl') {
    return {
      inputType: arg.inputType,
      defaultValue: arg.defaultValue,
      ...baseCommandArgument,
    } satisfies CommandArgument<O, T> & { inputType: 'kcl' }
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
