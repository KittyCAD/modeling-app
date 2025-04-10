import { useAppState } from '@src/AppState'
import { useEffect } from 'react'
import type { Actor, AnyStateMachine, EventFrom, StateFrom } from 'xstate'

import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { useKclContext } from '@src/lang/KclProvider'
import type {
  Command,
  StateMachineCommandSetConfig,
  StateMachineCommandSetSchema,
} from '@src/lib/commandTypes'
import { createMachineCommand } from '@src/lib/createMachineCommand'
import type { authMachine } from '@src/machines/authMachine'
import { commandBarActor } from '@src/machines/commandBarMachine'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { projectsMachine } from '@src/machines/projectsMachine'
import type { settingsMachine } from '@src/machines/settingsMachine'

// This might not be necessary, AnyStateMachine from xstate is working
export type AllMachines =
  | typeof modelingMachine
  | typeof settingsMachine
  | typeof authMachine
  | typeof projectsMachine

interface UseStateMachineCommandsArgs<
  T extends AllMachines,
  S extends StateMachineCommandSetSchema<T>,
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
  S extends StateMachineCommandSetSchema<T>,
>({
  machineId,
  state,
  send,
  actor,
  commandBarConfig,
  allCommandsRequireNetwork = false,
  onCancel,
}: UseStateMachineCommandsArgs<T, S>) {
  const { overallState } = useNetworkContext()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useAppState()

  useEffect(() => {
    const disableAllButtons =
      (overallState !== NetworkHealthState.Ok &&
        overallState !== NetworkHealthState.Weak) ||
      isExecuting ||
      !isStreamReady
    const newCommands = Object.keys(commandBarConfig || {})
      .filter((_) => !allCommandsRequireNetwork || !disableAllButtons)
      .flatMap((type) => {
        const typeWithProperType = type as EventFrom<T>['type']
        return createMachineCommand<T, S>({
          // The group is the owner machine's ID.
          groupId: machineId,
          type: typeWithProperType,
          state,
          send,
          actor,
          commandBarConfig,
          onCancel,
        })
      })
      .filter((c) => c !== null) as Command[] // TS isn't smart enough to know this filter removes nulls

    commandBarActor.send({
      type: 'Add commands',
      data: { commands: newCommands },
    })

    return () => {
      commandBarActor.send({
        type: 'Remove commands',
        data: { commands: newCommands },
      })
    }
  }, [overallState, isExecuting, isStreamReady])
}
