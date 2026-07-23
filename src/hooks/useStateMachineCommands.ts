import { useAppState } from '@src/AppState'
import { useEffect } from 'react'
import type { Actor, AnyStateMachine, EventFrom, StateFrom } from 'xstate'

import { useSignals } from '@preact/signals-react/runtime'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { shouldDisableModelingForUnrenderedChanges } from '@src/lib/automaticRendering'
import { useApp, useSingletons } from '@src/lib/boot'
import type {
  Command,
  StateMachineCommandSetConfig,
  StateMachineCommandSetSchema,
} from '@src/lib/commandTypes'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { createMachineCommand } from '@src/lib/createMachineCommand'

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
  useSignals()
  const { commands, settings, userFeatures } = useApp()
  const { kclManager } = useSingletons()
  const showExperimentalCommands = userFeatures.useHas(
    EXPERIMENTAL_POINT_AND_CLICK_FLAG,
    false
  )
  const useModelingDialogFeature = userFeatures.useHas(
    'modeling_dialogs',
    false
  )
  const settingsValues = settings.useSettings()
  const { overallState } = useNetworkContext()
  const { isStreamReady } = useAppState()
  const disableForUnrenderedChanges = shouldDisableModelingForUnrenderedChanges(
    {
      settings: settingsValues,
      hasEditsSinceLastExecution:
        kclManager.hasEditsSinceLastExecutionSignal.value,
    }
  )
  const shouldDisableEngineCommands =
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    isExecuting ||
    !isStreamReady ||
    disableForUnrenderedChanges
  const useModelingDialog = machineId === 'modeling' && useModelingDialogFeature

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
          showExperimentalCommands,
        })
      })
      .filter((c) => c !== null)
      .map((command) =>
        useModelingDialog
          ? {
              ...command,
              useModelingDialog,
            }
          : command
      ) as Command[] // TS isn't smart enough to know this filter removes nulls

    commands.send({
      type: 'Add commands',
      data: { commands: newCommands },
    })

    return () => {
      commands.send({
        type: 'Remove commands',
        data: { commands: newCommands },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [
    shouldDisableEngineCommands,
    showExperimentalCommands,
    commandBarConfig,
    useModelingDialog,
  ])
}
