import { useEffect } from 'react'
import { AnyStateMachine, Actor, StateFrom } from 'xstate'
import { createMachineCommand } from '../lib/createMachineCommand'
import { useCommandsContext } from './useCommandsContext'
import { modelingMachine } from 'machines/modelingMachine'
import { authMachine } from 'machines/authMachine'
import { settingsMachine } from 'machines/settingsMachine'
import { homeMachine } from 'machines/homeMachine'
import { useKclContext } from 'lang/KclProvider'
import {
  Command,
  StateMachineCommandSetConfig,
  StateMachineCommandSetSchema,
} from 'lib/commandTypes'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { useAppState } from 'AppState'
import { getActorNextEvents } from 'lib/utils'

// This might not be necessary, AnyStateMachine from xstate is working
export type AllMachines =
  | typeof modelingMachine
  | typeof settingsMachine
  | typeof authMachine
  | typeof homeMachine

interface UseStateMachineCommandsArgs<
  T extends AllMachines,
  S extends StateMachineCommandSetSchema<T>
> {
  machineId: T['id']
  state: StateFrom<T>
  send: Function
  actor: Actor<T>
  commandBarConfig?: StateMachineCommandSetConfig<T, S>
  allCommandsRequireNetwork?: boolean
  onCancel?: () => void
}

export default function useStateMachineCommands<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>
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
  const { overallState } = useNetworkContext()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useAppState()

  useEffect(() => {
    const disableAllButtons =
      (overallState !== NetworkHealthState.Ok &&
        overallState !== NetworkHealthState.Weak) ||
      isExecuting ||
      !isStreamReady
    const newCommands = getActorNextEvents(state)
      .filter((_) => !allCommandsRequireNetwork || !disableAllButtons)
      .filter((e) => !['done.', 'error.'].some((n) => e.includes(n)))
      .flatMap((type) =>
        createMachineCommand<T, S>({
          // The group is the owner machine's ID.
          groupId: machineId,
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
