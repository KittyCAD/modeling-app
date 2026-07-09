import type { WebContentSendPayload } from '@src/menu/channels'
import { useEffect, useRef } from 'react'

export function useMenuListener(
  callback: (data: WebContentSendPayload) => void
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!window.electron) {
      // NO OP for web
      return
    }

    const removeListener = window.electron.menuOn((data) => {
      callbackRef.current(data)
    })
    return () => {
      if (!window.electron) {
        // NO OP for web
        return
      }
      removeListener()
    }
  }, [])
}
