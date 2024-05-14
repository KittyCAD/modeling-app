import {
  NetworkHealthState,
  useNetworkStatus,
} from 'components/NetworkHealthIndicator'
import { useKclContext } from 'lang/KclProvider'
import { useStore } from 'useStore'

/**
 * Custom hook to determine if modeling actions should be disabled
 * based on the current network status, KCL execution status, and stream readiness.
 * @returns boolean
 */
export function useShouldDisableModelingActions() {
  const { overallState } = useNetworkStatus()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useStore((s) => ({
    isStreamReady: s.isStreamReady,
  }))

  return overallState !== NetworkHealthState.Ok || isExecuting || !isStreamReady
}
