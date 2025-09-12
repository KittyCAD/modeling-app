import { useEffect } from 'react'
import type { InteractionMapItem } from '@src/lib/settings/initialKeybindings'
import { interactionMapActor } from '@src/lib/singletons'

/**
 * Custom hook to add an interaction map to the interaction map machine
 * from within a component, and remove it when the component unmounts.
 * @param shortcutSet - An array of interaction map items.
 * @param deps - Any dependencies that should trigger a resetting of the interaction map when they change.
 */
export function useShortcuts(shortcutSet: InteractionMapItem[], deps: any[]) {
  useEffect(() => {
    interactionMapActor.send({
      type: 'Add to interaction map',
      data: shortcutSet,
    })

    return () => {
      console.log('tearing down hook')
      interactionMapActor.send({
        type: 'Remove from interaction map',
        data: shortcutSet,
      })
    }
  }, deps)
}
