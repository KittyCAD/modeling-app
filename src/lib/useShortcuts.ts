import { useEffect } from 'react'
import type { Shortcut } from '@src/lib/shortcuts'
import { shortcutService } from '@src/lib/singletons'

/**
 * Custom hook to add an interaction map to the interaction map machine
 * from within a component, and remove it when the component unmounts.
 * @param shortcutSet - An array of interaction map items.
 * @param deps - Any dependencies that should trigger a resetting of the interaction map when they change.
 */
export function useShortcuts(shortcutSet: Shortcut[]) {
  useEffect(() => {
    shortcutService.addShortcuts(shortcutSet)
    return () => {
      console.log('tearing down hook')
      shortcutService.removeShortcuts(shortcutSet)
    }
  }, [shortcutSet])
}

export function useEnableShortcuts(
  shortcutConfigs: { id: string; action: Shortcut['_action'] }[]
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
