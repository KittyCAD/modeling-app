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
  owner: T['id']
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
  owner,
  type,
  state,
  send,
  actor,
  commandBarConfig,
  onCancel,
}: CreateMachineCommandProps<T, S>): Command<T, S[typeof type]> | null {
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

  const command: Command<T, S[typeof type], typeof type> = {
    name: type,
    owner: owner,
    icon,
    onSubmit: (data: EventFrom<T, typeof type>) => {
      if (data !== undefined && data !== null) {
        send(type, { data })
      } else {
        send(type)
      }
    },
  }

  if (commandConfig.args) {
    console.log(command.args)
    const newArgs = buildCommandArguments(state, commandConfig.args, actor)

    // TODO: Figure out why this doesn't work
    // Type 'keyof S' is not assignable to type 'keyof S[ResolveEventType<T>["type"]]'.
    // Using type coercion because I'm fairly confident that `keyof S` is
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
  args: CommandConfig<T, S, CommandName>['args'],
  actor?: InterpreterFrom<T>
): Command<T, S>['args'] {
  const newArgs = {} as Command<T, S>['args']

  for (const arg in args) {
    const argConfig = args[arg] as CommandArgumentConfig<T, S[typeof arg]>
    const newArg = buildCommandArgument(argConfig, state, actor)
    newArgs![arg] = newArg
  }

  return newArgs
}

function buildCommandArgument<T extends AnyStateMachine, O>(
  arg: CommandArgumentConfig<T, O>,
  state: StateFrom<T>,
  actor?: InterpreterFrom<T>
): CommandArgument<T, O> & { inputType: typeof arg.inputType } {
  const payload = getPayload(arg, state)

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
      description: arg.description,
      skip: arg.skip,
      payload,
      options,
    } as CommandArgument<T, O> & { inputType: 'options' }
  } else if (arg.inputType === 'selection') {
    if (!actor)
      throw new Error('Actor must be provided for selection input type')

    return {
      inputType: arg.inputType,
      description: arg.description,
      skip: arg.skip,
      multiple: arg.multiple,
      payload,
    } as CommandArgument<T, O> & { inputType: 'selection' }
  } else {
    return {
      inputType: arg.inputType,
      description: arg.description,
      skip: arg.skip,
      payload,
    }
  }
}

function getPayload<T extends AnyStateMachine, O>(
  arg: CommandArgumentConfig<T, O>,
  state: StateFrom<T>
): NonNullable<O> {
  const payload = arg.payload
    ? arg.payload
    : arg.defaultValue
    ? arg.defaultValue instanceof Function
      ? arg.defaultValue(state.context)
      : arg.defaultValue
    : undefined

  if (payload === undefined || payload === null) {
    throw new Error('Either payload or default value must be provided')
  }
  return payload
}
