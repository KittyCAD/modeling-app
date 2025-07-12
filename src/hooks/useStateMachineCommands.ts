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
import { commandBarActor } from '@src/lib/singletons'

interface UseStateMachineCommandsArgs<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
> {
  machineId: T['id']
  state: StateFrom<T>
  send: (event: EventFrom<T>) => void
  actor: Actor<T>
  commandBarConfig?: StateMachineCommandSetConfig<T, S>
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
}: UseStateMachineCommandsArgs<T, S>) {
  const { overallState } = useNetworkContext()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useAppState()
  const shouldDisableEngineCommands =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    isExecuting ||
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
  }, [shouldDisableEngineCommands, commandBarConfig])
}
