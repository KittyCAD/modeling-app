import { useEffect } from 'react'
import { AnyStateMachine, StateFrom } from 'xstate'
import {
  Command,
  CommandBarConfig,
  createMachineCommand,
} from '../lib/commands'
import { useCommandsContext } from './useCommandsContext'

interface UseStateMachineCommandsArgs<T extends AnyStateMachine> {
  state: StateFrom<T>
  send: Function
  commandBarConfig?: CommandBarConfig<T>
  commands: Command[]
  owner: string
}

export default function useStateMachineCommands<T extends AnyStateMachine>({
  state,
  send,
  commandBarConfig,
  owner,
}: UseStateMachineCommandsArgs<T>) {
  const { addCommands, removeCommands } = useCommandsContext()

  useEffect(() => {
    const newCommands = state.nextEvents
      .filter((e) => !['done.', 'error.'].some((n) => e.includes(n)))
      .map((type) =>
        createMachineCommand<T>({
          type,
          state,
          send,
          commandBarConfig,
          owner,
        })
      )
      .filter((c) => c !== null) as Command[] // TS isn't smart enough to know this filter removes nulls

    addCommands(newCommands)

    return () => {
      removeCommands(newCommands)
    }
  }, [state])
}
