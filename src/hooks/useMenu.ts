import { useEffect } from 'react'

import { isDesktop } from '@src/lib/isDesktop'
import type { WebContentSendPayload } from '@src/menu/channels'

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
