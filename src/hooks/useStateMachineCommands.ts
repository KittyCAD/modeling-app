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
import { registerMachineCommands } from '@src/lib/registerMachineCommands'

interface UseStateMachineCommandsArgs<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
> {
  machineId: T['id']
  state: StateFrom<T>
  send: (event: EventFrom<T>) => void
  actor: Actor<T>
  commandBarConfig?: StateMachineCommandSetConfig<T, S>
  getDefaultDescription?: (type: EventFrom<T>['type']) => string | undefined
  scopes: Command['scopes']
  isExecuting: boolean
  onCancel?: () => void
}

/** Supplies legacy readiness checks to `registerMachineCommands`; other hosts can supply their own checks and command service. */
export default function useStateMachineCommands<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
>({
  machineId,
  state,
  send,
  actor,
  commandBarConfig,
  getDefaultDescription,
  scopes,
  onCancel,
  isExecuting,
}: UseStateMachineCommandsArgs<T, S>) {
  useSignals()
  const { commands, settings, userFeatures } = useApp()
  const { kclManager } = useSingletons()
  const kclProgramVersion = kclManager.kclProgramVersionSignal.value
  const showExperimentalCommands = userFeatures.useHas(
    EXPERIMENTAL_POINT_AND_CLICK_FLAG,
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

  useEffect(() => {
    return registerMachineCommands<T, S>(commands, {
      machineId,
      state,
      send,
      actor,
      commandBarConfig,
      getDefaultDescription,
      scopes,
      onCancel,
      forceDisable: shouldDisableEngineCommands,
      showExperimentalCommands,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [
    shouldDisableEngineCommands,
    showExperimentalCommands,
    commandBarConfig,
    getDefaultDescription,
    kclProgramVersion,
    scopes,
  ])
}
