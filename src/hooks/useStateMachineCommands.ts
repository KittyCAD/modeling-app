import { SetStateAction, useCallback, useEffect } from 'react'
import { AnyStateMachine, EventFrom, StateFrom } from 'xstate'
import { Command, CommandBarMeta, createMachineCommand } from '../lib/commands'

interface UseStateMachineCommandsArgs<T extends AnyStateMachine> {
  state: StateFrom<T>
  send: Function
  commandBarMeta?: CommandBarMeta
  setCommands: (value: React.SetStateAction<Command[]>) => void
  commands: Command[]
  owner: string
}

export default function useStateMachineCommands<T extends AnyStateMachine>({
  state,
  send,
  commandBarMeta,
  setCommands,
  commands,
  owner,
}: UseStateMachineCommandsArgs<T>) {
  const createNewMachineCommand = useCallback(
    (type: EventFrom<T>['type']) => {
      return createMachineCommand<T>({
        type,
        state,
        send,
        commandBarMeta,
        owner,
      })
    },
    [state, send, commandBarMeta]
  )

  useEffect(() => {
    const filteredExistingCommands = commands.filter((c) => c.owner !== owner)
    const newCommands = state.nextEvents
      .filter((e) => !['done.', 'error.'].some((n) => e.includes(n)))
      .map(createNewMachineCommand)
      .filter((c) => c !== null) as Command[]

    setCommands([...newCommands, ...filteredExistingCommands])

    return () => {
      setCommands(filteredExistingCommands)
    }
  }, [state])
}
