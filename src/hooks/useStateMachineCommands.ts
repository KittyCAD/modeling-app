import { useAppState } from '@src/AppState'
import { useEffect } from 'react'
import type { Actor, AnyStateMachine, EventFrom, StateFrom } from 'xstate'

import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import type {
  Command,
  StateMachineCommandSetConfig,
  StateMachineCommandSetSchema,
} from '@src/lib/commandTypes'
import { createMachineCommand } from '@src/lib/createMachineCommand'
import { useSingletons } from '@src/lib/singletons'

interface UseStateMachineCommandsArgs<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
> {
  machineId: T['id']
  state: StateFrom<T>
  send: (event: EventFrom<T>) => void
  actor: Actor<T>
  commandBarConfig?: StateMachineCommandSetConfig<T, S>
  isExecuting: boolean
  onCancel?: () => void
}

/**
 * @deprecated the type plumbing required for this function is way over-complicated.
 * Instead, opt to create `Commands` directly.
 *
 * This is only used for modelingMachine commands now, and once that is decoupled from React,
 * TODO: Delete this function and other state machine helper functions.
 */
export default function useStateMachineCommands<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
>({
  machineId,
  state,
  send,
  actor,
  commandBarConfig,
  onCancel,
  isExecuting,
}: UseStateMachineCommandsArgs<T, S>) {
  const { commandBarActor, kclManager } = useSingletons()
  const { overallState } = useNetworkContext()
  const { isStreamReady } = useAppState()
  const shouldDisableEngineCommands =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    kclManager.isExecutingSignal.value ||
    !isStreamReady

  useEffect(() => {
    const newCommands = Object.keys(commandBarConfig || {})
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
          forceDisable: shouldDisableEngineCommands,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [shouldDisableEngineCommands, commandBarConfig])
}
