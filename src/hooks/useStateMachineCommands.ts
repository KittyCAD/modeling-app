import { useContext, useEffect } from 'react'
import { AnyStateMachine, StateFrom } from 'xstate'
import { Command, CommandBarMeta, createMachineCommand } from '../lib/commands'
import { CommandsContext } from '../components/CommandBar'

interface UseStateMachineCommandsArgs<T extends AnyStateMachine> {
  state: StateFrom<T>
  send: Function
  commandBarMeta?: CommandBarMeta
  commands: Command[]
  owner: string
}

export default function useStateMachineCommands<T extends AnyStateMachine>({
  state,
  send,
  commandBarMeta,
  owner,
}: UseStateMachineCommandsArgs<T>) {
  const { addCommands, removeCommands } = useContext(CommandsContext)

  useEffect(() => {
    const newCommands = state.nextEvents
      .filter((e) => !['done.', 'error.'].some((n) => e.includes(n)))
      .map((type) =>
        createMachineCommand<T>({
          type,
          state,
          send,
          commandBarMeta,
          owner,
        })
      )
      .filter((c) => c !== null) as Command[]

    addCommands(newCommands)

    return () => {
      removeCommands(newCommands)
    }
  }, [state])
}
