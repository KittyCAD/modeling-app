import { AnyStateMachine, EventFrom, StateFrom } from 'xstate'

type InitialCommandBarMetaArg = {
  name: string
  type: 'string' | 'select'
  description?: string
  options: string | Array<{ name: string }>
}

export type CommandBarMeta = {
  [key: string]:
    | {
        displayValue: (args: string[]) => string
        args: InitialCommandBarMetaArg[]
      }
    | {
        hide?: true
      }
}

export type Command = {
  owner: string
  name: string
  callback: Function
  meta?: {
    displayValue(args: string[]): string | string
    args: SubCommand[]
  }
}

export type SubCommand = {
  name: string
  type: 'select' | 'string'
  description?: string
  options?: Partial<{ name: string }>[]
}

interface CommandBarArgs<T extends AnyStateMachine> {
  type: EventFrom<T>['type']
  state: StateFrom<T>
  commandBarMeta?: CommandBarMeta
  send: Function
  owner: string
}

export function createMachineCommand<T extends AnyStateMachine>({
  type,
  state,
  commandBarMeta,
  send,
  owner,
}: CommandBarArgs<T>): Command | null {
  const lookedUpMeta = commandBarMeta && commandBarMeta[type]
  if (lookedUpMeta && 'hide' in lookedUpMeta) return null
  let replacedArgs

  if (lookedUpMeta && 'args' in lookedUpMeta) {
    replacedArgs = lookedUpMeta.args.map((arg) => {
      const optionsFromContext = state.context[
        arg.options as keyof typeof state.context
      ] as { name: string }[] | string | undefined

      const options =
        arg.options instanceof Array
          ? arg.options
          : !optionsFromContext || typeof optionsFromContext === 'string'
          ? [
              {
                name: optionsFromContext,
                description: arg.description || '',
              },
            ]
          : optionsFromContext.map((o) => ({
              name: o.name || '',
              description: arg.description || '',
            }))

      return {
        ...arg,
        options,
      }
    }) as any[]
  }

  // We have to recreate this object every time,
  // otherwise we'll have stale state in the CommandBar
  // after completing our first action
  const meta = lookedUpMeta
    ? {
        ...lookedUpMeta,
        args: replacedArgs,
      }
    : undefined

  return {
    name: type,
    owner,
    callback: (data: EventFrom<T, typeof type>) => {
      if (data !== undefined && data !== null) {
        send(type, { data })
      } else {
        send(type)
      }
    },
    meta: meta as any,
  }
}
