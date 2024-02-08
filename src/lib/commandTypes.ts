import { CustomIconName } from 'components/CustomIcon'
import { AllMachines } from 'hooks/useStateMachineCommands'
import {
  AnyStateMachine,
  ContextFrom,
  EventFrom,
  InterpreterFrom,
} from 'xstate'
import { Selection } from './selections'

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
  [EventType in EventFrom<T>['type']]: Command<
    T,
    EventFrom<T>['type'],
    Schema[EventType]
  >
}>

export type CommandSetConfig<
  T extends AllMachines,
  Schema extends CommandSetSchema<T>
> = Partial<{
  [EventType in EventFrom<T>['type']]: CommandConfig<
    T,
    EventFrom<T>['type'],
    Schema[EventType]
  >
}>

export type Command<
  T extends AnyStateMachine = AnyStateMachine,
  CommandName extends EventFrom<T>['type'] = EventFrom<T>['type'],
  CommandSchema extends CommandSetSchema<T>[CommandName] = CommandSetSchema<T>[CommandName]
> = {
  name: CommandName
  ownerMachine: T['id']
  needsReview: boolean
  onSubmit: (data?: CommandSchema) => void
  onCancel?: () => void
  args?: {
    [ArgName in keyof CommandSchema]: CommandArgument<CommandSchema[ArgName], T>
  }
  description?: string
  icon?: Icon
  hide?: (typeof PLATFORMS)[number]
}

export type CommandConfig<
  T extends AnyStateMachine = AnyStateMachine,
  CommandName extends EventFrom<T>['type'] = EventFrom<T>['type'],
  CommandSchema extends CommandSetSchema<T>[CommandName] = CommandSetSchema<T>[CommandName]
> = Omit<
  Command<T, CommandName, CommandSchema>,
  'name' | 'ownerMachine' | 'onSubmit' | 'onCancel' | 'args' | 'needsReview'
> & {
  needsReview?: true
  args?: {
    [ArgName in keyof CommandSchema]: CommandArgumentConfig<
      CommandSchema[ArgName],
      T
    >
  }
}

export type CommandArgumentConfig<
  OutputType,
  T extends AnyStateMachine = AnyStateMachine
> =
  | {
      description?: string
      required: boolean
      skip?: true
      defaultValue?: OutputType | ((context: ContextFrom<T>) => OutputType)
    } & (
      | {
          inputType: Extract<CommandInputType, 'options'>
          options:
            | CommandArgumentOption<OutputType>[]
            | ((context: ContextFrom<T>) => CommandArgumentOption<OutputType>[])
        }
      | {
          inputType: Extract<CommandInputType, 'selection'>
          selectionTypes: Selection['type'][]
          multiple: boolean
        }
      | { inputType: Exclude<CommandInputType, 'options' | 'selection'> }
    )

export type CommandArgument<
  OutputType,
  T extends AnyStateMachine = AnyStateMachine
> =
  | {
      description?: string
      required: boolean
      skip?: true
      defaultValue?: OutputType | ((context: ContextFrom<T>) => OutputType)
    } & (
      | {
          inputType: Extract<CommandInputType, 'options'>
          options: CommandArgumentOption<OutputType>[]
        }
      | {
          inputType: Extract<CommandInputType, 'selection'>
          selectionTypes: Selection['type'][]
          actor: InterpreterFrom<T>
          multiple: boolean
        }
      | { inputType: Exclude<CommandInputType, 'options' | 'selection'> }
    )

export type CommandArgumentWithName<
  OutputType,
  T extends AnyStateMachine = AnyStateMachine
> = CommandArgument<OutputType, T> & {
  name: string
}

export type CommandArgumentOption<A> = {
  name: string
  isCurrent?: boolean
  value: A
}
