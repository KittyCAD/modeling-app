import { isDesktop } from 'lib/isDesktop'
import { useEffect } from 'react'

import type { WebContentSendPayload } from '../menu/channels'

export function useMenuListener(
  callback: (data: WebContentSendPayload) => void
) {
  useEffect(() => {
    const onDesktop = isDesktop()
    if (!onDesktop) {
      // NO OP for web
      return
    }

    const removeListener = window.electron.menuOn(callback)
    return () => {
      if (!onDesktop) {
        // NO OP for web
        return
      }
      removeListener()
    }
  }, [])
}
