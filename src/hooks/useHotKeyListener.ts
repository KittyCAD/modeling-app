import { useEffect } from 'react'

import type { KclManager } from '@src/lang/KclManager'
// Kurt's note: codeMirror styling overrides were needed to make this work
// namely, the cursor needs to still be shown when the editor is not focused
// search for code-mirror-override in the repo to find the relevant styles

/**
 * @deprecated Prefer registering shortcuts through `keymapValueSpec`.
 */
export function useHotKeyListener(kclManager: KclManager) {
  const keyName = 'Shift'
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) =>
      event.key === keyName && kclManager.setIsShiftDown(true)
    const handleKeyUp = (event: KeyboardEvent) =>
      event.key === keyName && kclManager.setIsShiftDown(false)
    const resetShiftKey = () => kclManager.setIsShiftDown(false)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        resetShiftKey()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    // If shift is released while window is out of focus, its state gets stuck in true
    // and the app thinks shift is still pressed down while it's not anymore.
    // -> better to reset on blur, it causes less problems and is more likely to be correct.
    // Ideally we don't keep track of isShiftDown but that's an involved refactor.
    window.addEventListener('blur', resetShiftKey)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', resetShiftKey)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [kclManager])
}
