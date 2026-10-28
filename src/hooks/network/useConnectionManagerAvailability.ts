import { useSignal } from '@preact/signals-react'
import type { ConnectionManager } from '@src/lib/engineConnection'
import { useEffect } from 'react'

/**
 *  We are trying to keep the ConnectionManager class free of Preact Signal dependencies,
 * so we react to its availability state from the outside here.
 */
export function useConnectionManagerAvailabilityAsSignal(
  engineCommandManager: ConnectionManager
) {
  const engineConnectionAvailability = useSignal(
    engineCommandManager.availability
  )
  useEffect(() => {
    engineConnectionAvailability.value = engineCommandManager.availability
  }, [engineCommandManager.availability, engineConnectionAvailability])

  return engineConnectionAvailability
}
