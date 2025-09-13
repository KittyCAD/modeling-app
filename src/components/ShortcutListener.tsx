import { shortcutService } from '@src/lib/singletons'
import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'

export const ShortcutListener = ({ children }: PropsWithChildren) => {
  // Setting up global event listeners
  useEffect(() => {
    shortcutService.start()
    return () => shortcutService.stop()
  }, [])

  return children
}
