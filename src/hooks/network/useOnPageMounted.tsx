import { engineCommandManager } from '@src/lib/singletons'
import { useEffect } from 'react'
let didUseEffectRunOnce = false

// Required for on page exit
const resetGlobalEngineCommandManager = () => {
  // reset the ability to initialize
  engineCommandManager.started = false
  didUseEffectRunOnce = false
}

export const useOnPageMounted = ({ callback }: { callback: () => void }) => {
  // Run once on initialization
  useEffect(() => {
    if (!didUseEffectRunOnce) {
      didUseEffectRunOnce = true
      callback()
    }
  }, [callback])

  return {
    resetGlobalEngineCommandManager,
  }
}
