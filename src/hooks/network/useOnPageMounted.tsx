import { engineCommandManager } from '@src/lib/singletons'
import { useEffect } from 'react'
let didUseEffectRunOnce = false

// Required for on page exit
const resetGlobalEngineCommandManager = () => {
  // reset the ability to initialize
  engineCommandManager.started = false
  didUseEffectRunOnce = false
}

/**
 * When the page mounts from a /file router call it will trigger the callback which will
 * be the engine connection call
 * This is the main entry point to start the engine connection when /file loads
 */
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
