import { isOffline } from '@src/lib/networkStatus'
import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void) {
  window.addEventListener('offline', listener)
  window.addEventListener('online', listener)
  return () => {
    window.removeEventListener('offline', listener)
    window.removeEventListener('online', listener)
  }
}

export function useIsOffline() {
  return useSyncExternalStore(subscribe, isOffline)
}
