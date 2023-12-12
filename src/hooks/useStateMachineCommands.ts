import { useEffect } from 'react'
import { AnyStateMachine, InterpreterFrom, StateFrom } from 'xstate'
import { createMachineCommand } from '../lib/createMachineCommand'
import { useCommandsContext } from './useCommandsContext'
import { modelingMachine } from 'machines/modelingMachine'
import { authMachine } from 'machines/authMachine'
import { settingsMachine } from 'machines/settingsMachine'
import { homeMachine } from 'machines/homeMachine'
import { Command, CommandSetConfig, CommandSetSchema } from 'lib/commandTypes'

// This might not be necessary, AnyStateMachine from xstate is working
export type AllMachines =
  | typeof modelingMachine
  | typeof settingsMachine
  | typeof authMachine
  | typeof homeMachine

interface UseStateMachineCommandsArgs<
  T extends AllMachines,
  S extends CommandSetSchema<T>
> {
  machineId: T['id']
  state: StateFrom<T>
  send: Function
  actor?: InterpreterFrom<T>
  commandBarConfig?: CommandSetConfig<T, S>
  onCancel?: () => void
}

export default function useStateMachineCommands<
  T extends AnyStateMachine,
  S extends CommandSetSchema<T>
>({
  machineId,
  state,
  send,
  actor,
  commandBarConfig,
  onCancel,
}: UseStateMachineCommandsArgs<T, S>) {
  const { commandBarSend } = useCommandsContext()

  useEffect(() => {
    const newCommands = state.nextEvents
      .filter((e) => !['done.', 'error.'].some((n) => e.includes(n)))
      .map((type) =>
        createMachineCommand<T, S>({
          ownerMachine: machineId,
          type,
          state,
          send,
          actor,
          commandBarConfig,
          onCancel,
        })
      )
      .filter((c) => c !== null) as Command[]

    commandBarSend({ type: 'Add commands', data: { commands: newCommands } })

    return () => {
      commandBarSend({
        type: 'Remove commands',
        data: { commands: newCommands },
      })
    }
  }, [state])
}
