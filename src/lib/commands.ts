import { AnyStateMachine, ContextFrom, EventFrom, StateFrom } from 'xstate'
import { isTauri } from './isTauri'
import { CustomIconName } from 'components/CustomIcon'

export const CMD_BAR_STOP_STATE_PREFIX = 'Command parameters:'
export const CMD_BAR_STOP_EVENT_PREFIX = 'Execute command:'

type Icon = CustomIconName
type Platform = 'both' | 'web' | 'desktop'
type InputType = 'select' | 'string' | 'number' | 'selection'
export type CommandArgumentOption = { name: string; isCurrent?: boolean }

// Command arguments can either be defined manually
// or flagged as needing to be looked up from the context.
// This is useful for things like settings, where
// we want to show the current setting value as the default.
// The lookup is done in createMachineCommand.
type CommandArgumentConfig<T extends AnyStateMachine> = {
  name: string // TODO: I would love for this to be strongly-typed so we could guarantee it's a valid data payload key on the event type.
  type: InputType
  description?: string
  skip?: true
} & (
  | {
      type: 'select'
      options?: CommandArgumentOption[]
      getOptionsFromContext?: keyof ContextFrom<T>
      defaultValue?: string
      getDefaultValueFromContext?: keyof ContextFrom<T>
    }
  | {
      type: 'string' | 'number'
      defaultValue?: string | number
      getDefaultValueFromContext?: keyof ContextFrom<T>
    }
  | { type: 'selection'; multiple: boolean }
)

export type CommandBarConfig<T extends AnyStateMachine> = Partial<{
  [EventType in EventFrom<T>['type']]:
    | {
        args: CommandArgumentConfig<T>[]
        formatFunction?: (args: string[]) => string
        icon?: Icon
        autoselect?: true
        hide?: Platform
      }
    | {
        hide?: Platform
      }
}>

export type Command = {
  owner: string
  name: string
  callback: Function
  icon?: Icon
  autoselect?: true
  cancelCallback?: Function
  args?: CommandArgument[]
  formatFunction?: (args: string[]) => string
}

export type CommandArgument = {
  name: string
  defaultValue?: string
} & (
  | {
      type: Extract<InputType, 'select'>
      options: CommandArgumentOption[]
    }
  | {
      type: Exclude<InputType, 'select'>
    }
)

interface CreateMachineCommandProps<T extends AnyStateMachine> {
  type: EventFrom<T>['type']
  state: StateFrom<T>
  commandBarConfig?: CommandBarConfig<T>
  send: Function
  owner: string
  onCancelCallback?: () => void
}

// Creates a command with subcommands, ready for use in the CommandBar component,
// from a more terse Command Bar Meta definition.
export function createMachineCommand<T extends AnyStateMachine>({
  type,
  state,
  commandBarConfig,
  send,
  owner,
  onCancelCallback,
}: CreateMachineCommandProps<T>): Command | null {
  const lookedUpMeta = commandBarConfig && commandBarConfig[type]
  if (!lookedUpMeta) return null

  // Hide commands based on platform by returning `null`
  // so the consumer can filter them out
  if ('hide' in lookedUpMeta) {
    const { hide } = lookedUpMeta
    if (hide === 'both') return null
    else if (hide === 'desktop' && isTauri()) return null
    else if (hide === 'web' && !isTauri()) return null
  }

  const icon = ('icon' in lookedUpMeta && lookedUpMeta.icon) || undefined
  const formatFunction =
    ('formatFunction' in lookedUpMeta && lookedUpMeta.formatFunction) ||
    undefined

  const command: Command = {
    name: type,
    owner,
    icon,
    callback: (data: EventFrom<T, typeof type>) => {
      if (data !== undefined && data !== null) {
        send(type, { data })
      } else {
        send(type)
      }
    },
    ...('args' in lookedUpMeta
      ? {
          args: getCommandArgumentValuesFromContext(state, lookedUpMeta.args),
          formatFunction,
        }
      : {}),
  }

  if ('autoselect' in lookedUpMeta && lookedUpMeta.autoselect) {
    command.autoselect = true
  }
  if (onCancelCallback) {
    command.cancelCallback = onCancelCallback
  }

  return command
}

function getCommandArgumentValuesFromContext<T extends AnyStateMachine>(
  state: StateFrom<T>,
  args: CommandArgumentConfig<T>[]
): CommandArgument[] {
  function getDefaultValue(
    arg: CommandArgumentConfig<T> & { type: 'string' | 'select' }
  ) {
    if (
      arg.type === 'select' ||
      ('getDefaultValueFromContext' in arg && arg.getDefaultValueFromContext)
    ) {
      return state.context[arg.getDefaultValueFromContext]
    } else {
      return arg.defaultValue
    }
  }

  return args.map((arg) => {
    switch (arg.type) {
      case 'selection':
        return {
          name: arg.name,
          type: 'selection',
        }
      case 'number':
        return {
          name: arg.name,
          type: arg.type,
          defaultValue: arg.getDefaultValueFromContext
            ? state.context[arg.getDefaultValueFromContext]
            : arg.defaultValue,
        }
      case 'string':
        return {
          name: arg.name,
          type: arg.type,
          defaultValue: arg.getDefaultValueFromContext
            ? state.context[arg.getDefaultValueFromContext]
            : arg.defaultValue,
        }
      default:
        return {
          name: arg.name,
          type: arg.type,
          defaultValue: getDefaultValue(arg),
          options: arg.getOptionsFromContext
            ? state.context[arg.getOptionsFromContext].map(
                (v: string | { name: string }) => ({
                  name: typeof v === 'string' ? v : v.name,
                  isCurrent: v === getDefaultValue(arg),
                })
              )
            : arg.getDefaultValueFromContext
            ? arg.options?.map((v) => ({
                ...v,
                isCurrent: v.name === getDefaultValue(arg),
              }))
            : arg.options,
        }
    }
  })
}
