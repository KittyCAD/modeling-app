import { S } from '@tauri-apps/api/dialog-20ff401c'
import { AnyStateMachine, EventFrom, StateFrom } from 'xstate'

type InitialCommandBarMetaArg = {
  name: string
  type: 'string' | 'select'
  description?: string
  options: string
}

export type CommandBarMeta = {
  [key: string]: {
    displayValue: (args: string[]) => string
    args: InitialCommandBarMetaArg[]
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
  commandBarMeta: CommandBarMeta
  send: Function
}

export function createCommand<T extends AnyStateMachine>({
  type,
  state,
  commandBarMeta,
  send,
}: CommandBarArgs<T>): Command {
  const lookedUpMeta = commandBarMeta[type]
  let replacedArgs

  if (lookedUpMeta) {
    replacedArgs = lookedUpMeta.args.map((arg) => {
      const optionsFromContext = state.context[
        arg.options as keyof typeof state.context
      ] as { name: string }[]

      const options =
        !optionsFromContext || typeof optionsFromContext === 'string'
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
    owner: 'home',
    callback: (data: EventFrom<T, typeof type>) => {
      send(type, { data })
    },
    meta: meta as any,
  }
}
