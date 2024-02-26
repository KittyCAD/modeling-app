import { AnyStateMachine, EventFrom, InterpreterFrom, StateFrom } from 'xstate'
import { isTauri } from './isTauri'
import {
  Command,
  CommandArgument,
  CommandArgumentConfig,
  CommandConfig,
  CommandSetConfig,
  CommandSetSchema,
} from './commandTypes'

interface CreateMachineCommandProps<
  T extends AnyStateMachine,
  S extends CommandSetSchema<T>
> {
  type: EventFrom<T>['type']
  ownerMachine: T['id']
  state: StateFrom<T>
  send: Function
  actor?: InterpreterFrom<T>
  commandBarConfig?: CommandSetConfig<T, S>
  onCancel?: () => void
}

// Creates a command with subcommands, ready for use in the CommandBar component,
// from a more terse Command Bar Meta definition.
export function createMachineCommand<
  T extends AnyStateMachine,
  S extends CommandSetSchema<T>
>({
  ownerMachine,
  type,
  state,
  send,
  actor,
  commandBarConfig,
  onCancel,
}: CreateMachineCommandProps<T, S>): Command<
  T,
  typeof type,
  S[typeof type]
> | null {
  const commandConfig = commandBarConfig && commandBarConfig[type]
  if (!commandConfig) return null

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
    ownerMachine: ownerMachine,
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

  return command
}

// Takes the args from a CommandConfig and creates
// a finalized CommandArgument object for each one,
// bundled together into the args for a Command.
function buildCommandArguments<
  T extends AnyStateMachine,
  S extends CommandSetSchema<T>,
  CommandName extends EventFrom<T>['type'] = EventFrom<T>['type']
>(
  state: StateFrom<T>,
  args: CommandConfig<T, CommandName, S>['args'],
  actor?: InterpreterFrom<T>
): NonNullable<Command<T, CommandName, S>['args']> {
  const newArgs = {} as NonNullable<Command<T, CommandName, S>['args']>

  for (const arg in args) {
    const argConfig = args[arg] as CommandArgumentConfig<S[typeof arg], T>
    const newArg = buildCommandArgument(argConfig, arg, state, actor)
    newArgs[arg] = newArg
  }

  return newArgs
}

function buildCommandArgument<
  O extends CommandSetSchema<T>,
  T extends AnyStateMachine
>(
  arg: CommandArgumentConfig<O, T>,
  argName: string,
  state: StateFrom<T>,
  actor?: InterpreterFrom<T>
): CommandArgument<O, T> & { inputType: typeof arg.inputType } {
  const baseCommandArgument = {
    description: arg.description,
    required: arg.required,
    skip: arg.skip,
  } satisfies Omit<CommandArgument<O, T>, 'inputType'>

  if (arg.inputType === 'options') {
    const options = arg.options
      ? arg.options instanceof Function
        ? arg.options(state.context)
        : arg.options
      : undefined

    if (!options) {
      throw new Error('Options must be provided for options input type')
    }

    return {
      inputType: arg.inputType,
      ...baseCommandArgument,
      defaultValue:
        arg.defaultValue instanceof Function
          ? arg.defaultValue(state.context)
          : arg.defaultValue,
      options,
    } satisfies CommandArgument<O, T> & { inputType: 'options' }
  } else if (arg.inputType === 'selection') {
    if (!actor)
      throw new Error('Actor must be provided for selection input type')

    return {
      inputType: arg.inputType,
      ...baseCommandArgument,
      multiple: arg.multiple,
      selectionTypes: arg.selectionTypes,
      actor,
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
      defaultValue:
        arg.defaultValue instanceof Function
          ? arg.defaultValue(state.context)
          : arg.defaultValue,
      ...baseCommandArgument,
    }
  }
}
