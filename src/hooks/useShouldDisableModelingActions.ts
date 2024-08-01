import { useAppState } from 'AppState'
import { NetworkHealthState, useNetworkStatus } from 'hooks/useNetworkStatus'
import { useKclContext } from 'lang/KclProvider'

/**
 * Custom hook to determine if modeling actions should be disabled
 * based on the current network status, KCL execution status, and stream readiness.
 * @returns boolean
 */
export function useShouldDisableModelingActions() {
  const { overallState } = useNetworkStatus()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useAppState()

  return overallState !== NetworkHealthState.Ok || isExecuting || !isStreamReady
}
