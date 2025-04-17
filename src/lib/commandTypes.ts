import type { EntityType_type } from '@kittycad/lib/dist/types/src/models'
import type { ReactNode } from 'react'
import type { Actor, AnyStateMachine, ContextFrom, EventFrom } from 'xstate'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { CustomIconName } from '@src/components/CustomIcon'
import type { MachineManager } from '@src/components/MachineManagerProvider'
import type { AllMachines } from '@src/hooks/useStateMachineCommands'
import type { Artifact } from '@src/lang/std/artifactGraph'
import type { Expr, Name, VariableDeclaration } from '@src/lang/wasm'
import type {
  CommandBarContext,
  commandBarMachine,
} from '@src/machines/commandBarMachine'

type Icon = CustomIconName
const _PLATFORMS = ['both', 'web', 'desktop'] as const
type PLATFORM = typeof _PLATFORMS
const _INPUT_TYPES = [
  'options',
  'string',
  'text',
  'kcl',
  'selection',
  'selectionMixed',
  'boolean',
] as const
type INPUT_TYPE = typeof _INPUT_TYPES
export interface KclExpression {
  valueAst: Expr
  valueText: string
  valueCalculated: string
}
export interface KclExpressionWithVariable extends KclExpression {
  variableName: string
  variableDeclarationAst: Node<VariableDeclaration>
  variableIdentifierAst: Node<Name>
  insertIndex: number
}
export type KclCommandValue = KclExpression | KclExpressionWithVariable
export type CommandInputType = INPUT_TYPE[number]

export type StateMachineCommandSetSchema<T extends AnyStateMachine> = Partial<{
  [EventType in EventFrom<T>['type']]: Record<string, any>
}>

export type StateMachineCommandSet<
  T extends AllMachines,
  Schema extends StateMachineCommandSetSchema<T>,
> = Partial<{
  [EventType in EventFrom<T>['type']]: Command<
    T,
    EventFrom<T>['type'],
    Schema[EventType]
  >
}>

/**
 * A configuration object for a set of commands tied to a state machine.
 * Each event type can have one or more commands associated with it.
 * @param T The state machine type.
 * @param Schema The schema for the command set, defined by the developer.
 */
export type StateMachineCommandSetConfig<
  T extends AllMachines,
  Schema extends StateMachineCommandSetSchema<T>,
> = Partial<{
  [EventType in EventFrom<T>['type']]:
    | CommandConfig<T, EventFrom<T>['type'], Schema[EventType]>
    | CommandConfig<T, EventFrom<T>['type'], Schema[EventType]>[]
}>

export type Command<
  T extends AnyStateMachine = AnyStateMachine,
  CommandName extends EventFrom<T>['type'] = EventFrom<T>['type'],
  CommandSchema extends
    StateMachineCommandSetSchema<T>[CommandName] = StateMachineCommandSetSchema<T>[CommandName],
> = {
  name: CommandName
  groupId: T['id']
  needsReview: boolean
  reviewMessage?:
    | string
    | ReactNode
    | ((
        commandBarContext: { argumentsToSubmit: Record<string, unknown> } // Should be the commandbarMachine's context, but it creates a circular dependency
      ) => string | ReactNode)
  machineActor?: Actor<T>
  onSubmit: (data?: CommandSchema) => void
  onCancel?: () => void
  args?: {
    [ArgName in keyof CommandSchema]: CommandArgument<CommandSchema[ArgName], T>
  }
  displayName?: string
  description?: string
  icon?: Icon
  hide?: PLATFORM[number]
}

export type CommandConfig<
  T extends AnyStateMachine = AnyStateMachine,
  CommandName extends EventFrom<T>['type'] = EventFrom<T>['type'],
  CommandSchema extends
    StateMachineCommandSetSchema<T>[CommandName] = StateMachineCommandSetSchema<T>[CommandName],
> = Omit<
  Command<T, CommandName, CommandSchema>,
  'name' | 'groupId' | 'onSubmit' | 'onCancel' | 'args' | 'needsReview'
> & {
  needsReview?: boolean
  status?: 'active' | 'development' | 'inactive'
  args?: {
    [ArgName in keyof CommandSchema]: CommandArgumentConfig<
      CommandSchema[ArgName],
      ContextFrom<T>
    >
  }
}

export type CommandArgumentConfig<
  OutputType,
  C = ContextFrom<AnyStateMachine>,
> = {
  displayName?: string
  description?: string
  required:
    | boolean
    | ((
        commandBarContext: { argumentsToSubmit: Record<string, unknown> }, // Should be the commandbarMachine's context, but it creates a circular dependency
        machineContext?: C
      ) => boolean)
  warningMessage?: string
  /** If `true`, arg is used as passed-through data, never for user input */
  hidden?:
    | boolean
    | ((
        commandBarContext: { argumentsToSubmit: Record<string, unknown> }, // Should be the commandbarMachine's context, but it creates a circular dependency
        machineContext?: C
      ) => boolean)
  skip?: boolean
  /** For showing a summary display of the current value, such as in
   *  the command bar's header
   */
  valueSummary?: (value: OutputType) => string
} & (
  | {
      inputType: 'options'
      options:
        | CommandArgumentOption<OutputType>[]
        | ((
            commandBarContext: {
              argumentsToSubmit: Record<string, unknown>
              machineManager?: MachineManager
            }, // Should be the commandbarMachine's context, but it creates a circular dependency
            machineContext?: C
          ) => CommandArgumentOption<OutputType>[])
      optionsFromContext?: (context: C) => CommandArgumentOption<OutputType>[]
      defaultValue?:
        | OutputType
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: C
          ) => OutputType)
      defaultValueFromContext?: (context: C) => OutputType
    }
  | {
      inputType: 'selection'
      selectionTypes: Artifact['type'][]
      clearSelectionFirst?: boolean
      selectionFilter?: EntityType_type[]
      multiple: boolean
      validation?: ({
        data,
        context,
      }: {
        data: any
        context: CommandBarContext
      }) => Promise<boolean | string>
    }
  | {
      inputType: 'selectionMixed'
      selectionTypes: Artifact['type'][]
      selectionFilter?: EntityType_type[]
      multiple: boolean
      allowNoSelection?: boolean
      validation?: ({
        data,
        context,
      }: {
        data: any
        context: CommandBarContext
      }) => Promise<boolean | string>
      selectionSource?: {
        allowSceneSelection?: boolean
        allowCodeSelection?: boolean
      }
    }
  | {
      inputType: 'kcl'
      createVariable?: 'byDefault' | 'force' | 'disallow'
      variableName?:
        | string
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: C
          ) => string)
      defaultValue?:
        | string
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: C
          ) => string)
    }
  | {
      inputType: 'string'
      defaultValue?:
        | OutputType
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: C
          ) => OutputType)
      defaultValueFromContext?: (context: C) => OutputType
    }
  | {
      inputType: 'text'
      defaultValue?:
        | OutputType
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: C
          ) => OutputType)
      defaultValueFromContext?: (context: C) => OutputType
    }
  | {
      inputType: 'boolean'
      defaultValue?:
        | OutputType
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: C
          ) => OutputType)
      defaultValueFromContext?: (context: C) => OutputType
    }
)

export type CommandArgument<
  OutputType,
  T extends AnyStateMachine = AnyStateMachine,
> = {
  displayName?: string
  description?: string
  required:
    | boolean
    | ((
        commandBarContext: { argumentsToSubmit: Record<string, unknown> }, // Should be the commandbarMachine's context, but it creates a circular dependency
        machineContext?: ContextFrom<T>
      ) => boolean)
  /** If `true`, arg is used as passed-through data, never for user input */
  hidden?:
    | boolean
    | ((
        commandBarContext: { argumentsToSubmit: Record<string, unknown> }, // Should be the commandbarMachine's context, but it creates a circular dependency
        machineContext?: ContextFrom<T>
      ) => boolean)
  skip?: boolean
  machineActor?: Actor<T>
  warningMessage?: string
  /** For showing a summary display of the current value, such as in
   *  the command bar's header
   */
  valueSummary?: (value: OutputType) => string
} & (
  | {
      inputType: Extract<CommandInputType, 'options'>
      options:
        | CommandArgumentOption<OutputType>[]
        | ((
            commandBarContext: {
              argumentsToSubmit: Record<string, unknown>
            }, // Should be the commandbarMachine's context, but it creates a circular dependency
            machineContext?: ContextFrom<T>
          ) => CommandArgumentOption<OutputType>[])
      defaultValue?:
        | OutputType
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: ContextFrom<T>
          ) => OutputType)
    }
  | {
      inputType: 'selection'
      selectionTypes: Artifact['type'][]
      clearSelectionFirst?: boolean
      selectionFilter?: EntityType_type[]
      multiple: boolean
      validation?: ({
        data,
        context,
      }: {
        data: any
        context: CommandBarContext
      }) => Promise<boolean | string>
    }
  | {
      inputType: 'selectionMixed'
      selectionTypes: Artifact['type'][]
      selectionFilter?: EntityType_type[]
      multiple: boolean
      allowNoSelection?: boolean
      validation?: ({
        data,
        context,
      }: {
        data: any
        context: CommandBarContext
      }) => Promise<boolean | string>
      selectionSource?: {
        allowSceneSelection?: boolean
        allowCodeSelection?: boolean
      }
    }
  | {
      inputType: 'kcl'
      createVariable?: 'byDefault' | 'force' | 'disallow'
      variableName?:
        | string
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: ContextFrom<T>
          ) => string)
      defaultValue?:
        | string
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: ContextFrom<T>
          ) => string)
    }
  | {
      inputType: 'string'
      defaultValue?:
        | OutputType
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: ContextFrom<T>
          ) => OutputType)
    }
  | {
      inputType: 'path'
      defaultValue?:
        | OutputType
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: ContextFrom<T>
          ) => OutputType)
    }
  | {
      inputType: 'text'
      defaultValue?:
        | OutputType
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: ContextFrom<T>
          ) => OutputType)
    }
  | {
      inputType: 'boolean'
      defaultValue?:
        | OutputType
        | ((
            commandBarContext: ContextFrom<typeof commandBarMachine>,
            machineContext?: ContextFrom<T>
          ) => OutputType)
    }
)

export type CommandArgumentWithName<
  OutputType,
  T extends AnyStateMachine = AnyStateMachine,
> = CommandArgument<OutputType, T> & {
  name: string
}

export type CommandArgumentOption<A> = {
  name: string
  isCurrent?: boolean
  disabled?: boolean
  value: A
}
