import { useEffect } from 'react'
import type { Shortcut } from '@src/lib/shortcuts'
import { shortcutService } from '@src/lib/singletons'
import type { ShortcutId } from '@src/lib/shortcuts/config'

/**
 * Enable a set of shortcuts for the lifecycle of a component
 */
export function useEnableShortcuts(
  shortcutConfigs: { id: ShortcutId; action: Shortcut['_action'] }[]
) {
  useEffect(() => {
    for (const config of shortcutConfigs) {
      const match = shortcutService.shortcuts.get(config.id)
      if (match) {
        match.enabled = true
        match.setAction(config.action)
      }
    }
    return () => {
      for (const config of shortcutConfigs) {
        const match = shortcutService.shortcuts.get(config.id)
        if (match) {
          match.enabled = true
          match.setAction(config.action)
        }
      }
    }
  }, [shortcutConfigs])
}
