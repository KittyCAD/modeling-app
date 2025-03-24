import { useEffect } from 'react'
import type { WebContentSendPayload } from '../menu/channels'
import { isDesktop } from 'lib/isDesktop'
export function useMenuListener(
  callback: (data: WebContentSendPayload) => void
) {
  useEffect(() => {
    const onDesktop = isDesktop()
    if (!onDesktop) {
      // NO OP for web
      return
    }

    var a = new Error()
    console.log("[okay]re initializing")
    window.electron.menuOn(callback)
    return () => {
      console.log("[okay]exiting!", callback)
      if (!onDesktop) {
        // NO OP for web
        return
      }
      window.electron.menuOff(callback)
    }
  }, [])
}
