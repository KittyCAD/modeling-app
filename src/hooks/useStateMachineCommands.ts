import { useEffect } from 'react'
import { AnyStateMachine, InterpreterFrom, StateFrom } from 'xstate'
import { createMachineCommand } from '../lib/createMachineCommand'
import { useCommandsContext } from './useCommandsContext'
import { modelingMachine } from 'machines/modelingMachine'
import { authMachine } from 'machines/authMachine'
import { settingsMachine } from 'machines/settingsMachine'
import { homeMachine } from 'machines/homeMachine'
import { Command, CommandSetConfig, CommandSetSchema } from 'lib/commandTypes'
import {
  NetworkHealthState,
  useNetworkStatus,
} from 'components/NetworkHealthIndicator'
import { useKclContext } from 'lang/KclSingleton'
import { useStore } from 'useStore'

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
  actor: InterpreterFrom<T>
  commandBarConfig?: CommandSetConfig<T, S>
  allCommandsRequireNetwork?: boolean
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
  allCommandsRequireNetwork = false,
  onCancel,
}: UseStateMachineCommandsArgs<T, S>) {
  const { commandBarSend } = useCommandsContext()
  const { overallState } = useNetworkStatus()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useStore((s) => ({
    isStreamReady: s.isStreamReady,
  }))

  useEffect(() => {
    const disableAllButtons =
      overallState !== NetworkHealthState.Ok || isExecuting || !isStreamReady
    const newCommands = state.nextEvents
      .filter((_) => !allCommandsRequireNetwork || !disableAllButtons)
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
      .filter((c) => c !== null) as Command[] // TS isn't smart enough to know this filter removes nulls

    commandBarSend({ type: 'Add commands', data: { commands: newCommands } })

    return () => {
      commandBarSend({
        type: 'Remove commands',
        data: { commands: newCommands },
      })
    }
  }, [state, overallState, isExecuting, isStreamReady])
}
