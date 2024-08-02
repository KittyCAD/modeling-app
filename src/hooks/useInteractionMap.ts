import { InteractionMapItem } from 'machines/interactionMapMachine'
import { useEffect, useMemo } from 'react'
import { useInteractionMapContext } from './useInteractionMapContext'
import { INTERACTION_MAP_SEPARATOR } from 'lib/constants'

/**
 * Custom hook to add an interaction map to the interaction map machine
 * from within a component, and remove it when the component unmounts.
 * @param deps - Any dependencies that should trigger a resetting of the interaction map when they change.
 */
export function useInteractionMap(
  /** An ID for the interaction map set. */
  ownerId: string,
  /** A set of iteraction map items to add */
  items: Record<string, InteractionMapItem>,
  /** Any dependencies that should invalidate the items */
  deps: any[]
) {
  const interactionMachine = useInteractionMapContext()
  const memoizedItems = useMemo(() => items, deps)
  const itemKeys = Object.keys(memoizedItems).map(
    (key) => `${ownerId}${INTERACTION_MAP_SEPARATOR}${key}`
  )

  useEffect(() => {
    interactionMachine.send({
      type: 'Add to interaction map',
      data: {
        ownerId,
        items: memoizedItems,
      },
    })

    return () => {
      interactionMachine.send({
        type: 'Remove from interaction map',
        data: itemKeys,
      })
    }
  }, [memoizedItems])
}
