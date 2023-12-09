import { CustomIconName } from 'components/CustomIcon'
import { AllMachines } from 'hooks/useStateMachineCommands'
import { AnyStateMachine, ContextFrom, EventFrom } from 'xstate'

type Icon = CustomIconName
const PLATFORMS = ['both', 'web', 'desktop'] as const
const INPUT_TYPES = ['options', 'string', 'number', 'selection'] as const
export type CommandInputType = (typeof INPUT_TYPES)[number]

export type CommandSetSchema<T extends AnyStateMachine> = Partial<{
  [EventType in EventFrom<T>['type']]: Record<string, any>
}>

export type CommandSet<
  T extends AllMachines,
  Schema extends CommandSetSchema<T>
> = Partial<{
  [EventType in EventFrom<T>['type']]: Command<T, Schema[EventType]>
}>

export type CommandSetConfig<
  T extends AllMachines,
  Schema extends CommandSetSchema<T>
> = Partial<{
  [EventType in EventFrom<T>['type']]: CommandConfig<T, Schema[EventType]>
}>

export type Command<
  T extends AnyStateMachine,
  CommandSchema,
  CommandName extends EventFrom<T>['type'] = EventFrom<T>['type']
> = {
  name: CommandName
  owner: T['id']
  onSubmit: (data: EventFrom<T>['type']) => void
  onCancel?: () => void
  args?: {
    [ArgName in keyof CommandSchema]: CommandArgument<T, CommandSchema[ArgName]>
  }
  description?: string
  icon?: Icon
  hide?: (typeof PLATFORMS)[number]
}

export type CommandConfig<
  T extends AnyStateMachine,
  CommandSchema extends CommandSetSchema<T>[CommandName],
  CommandName extends EventFrom<T>['type'] = EventFrom<T>['type']
> = Omit<
  Command<T, CommandSchema>,
  'name' | 'owner' | 'onSubmit' | 'onCancel' | 'args'
> & {
  args?: {
    [ArgName in keyof CommandSchema]: CommandArgumentConfig<
      T,
      CommandSchema[ArgName]
    >
  }
}

export type CommandArgumentConfig<T extends AnyStateMachine, OutputType> =
  | BaseCommandArgumentConfig<T, OutputType> &
      (
        | OptionsCommandArugmentConfig<T, OutputType>
        | SelectionCommandArgumentConfig
        | { inputType: Exclude<CommandInputType, 'options' | 'selection'> }
      )

type BaseCommandArgumentConfig<T extends AnyStateMachine, OutputType> = {
  description?: string
  skip?: true
  defaultValue?: OutputType | ((context: ContextFrom<T>) => OutputType)
  payload?: OutputType
}

type OptionsCommandArugmentConfig<T extends AnyStateMachine, OutputType> = {
  inputType: Extract<CommandInputType, 'options'>
  options:
    | CommandArgumentOption<OutputType>[]
    | ((context: ContextFrom<T>) => CommandArgumentOption<OutputType>[])
}

type SelectionCommandArgumentConfig = {
  inputType: Extract<CommandInputType, 'selection'>
  multiple: boolean
}

export type CommandArgument<T extends AnyStateMachine, OutputType> = {
  payload: OutputType
} & Omit<
  CommandArgumentConfig<T, OutputType>,
  'getOptionsFromContext' | 'getDefaultValueFromContext' | 'defaultValue'
>

export type CommandArgumentOption<A> = {
  name: string
  isCurrent?: boolean
  value: A
}
