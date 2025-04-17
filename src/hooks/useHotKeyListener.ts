import { useEffect } from 'react'

import { editorManager } from '@src/lib/singletons'

// Kurt's note: codeMirror styling overrides were needed to make this work
// namely, the cursor needs to still be shown when the editor is not focused
// search for code-mirror-override in the repo to find the relevant styles

export function useHotKeyListener() {
  const keyName = 'Shift'
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) =>
      event.key === keyName && editorManager.setIsShiftDown(true)
    const handleKeyUp = (event: KeyboardEvent) =>
      event.key === keyName && editorManager.setIsShiftDown(false)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  })
}
