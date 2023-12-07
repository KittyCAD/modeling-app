import { useEffect } from 'react'
import { AnyStateMachine, StateFrom } from 'xstate'
import {
  CMD_BAR_STOP_EVENT_PREFIX,
  CMD_BAR_STOP_STATE_PREFIX,
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
  onCancelCallback?: () => void
}

export default function useStateMachineCommands<T extends AnyStateMachine>({
  state,
  send,
  commandBarConfig,
  owner,
  onCancelCallback,
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
          onCancelCallback,
        })
      )
      .filter((c) => c !== null) as Command[] // TS isn't smart enough to know this filter removes nulls

    addCommands(newCommands)

    return () => {
      removeCommands(newCommands)
    }
  }, [state])
}
