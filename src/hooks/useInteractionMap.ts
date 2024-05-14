import { InteractionMapItem } from 'machines/interactionMapMachine'
import { useEffect, useMemo } from 'react'
import { useInteractionMapContext } from './useInteractionMapContext'

/**
 * Custom hook to add an interaction map to the interaction map machine
 * from within a component, and remove it when the component unmounts.
 * @param interactionMap - An array of interaction map items. You don't need to provide an `ownerId` property, as it will be added automatically.
 * @param deps - Any dependencies that should trigger a resetting of the interaction map when they change.
 * @param mapId - An optional ID for the interaction map. If not provided, a random UUID will be generated.
 */
export function useInteractionMap(
  interactionMap: Omit<InteractionMapItem, 'ownerId'>[],
  deps: any[],
  mapId?: string
) {
  const interactionMachine = useInteractionMapContext()
  const mapIdMemoized = useMemo<string>(
    () => mapId || crypto.randomUUID(),
    [mapId]
  )
  const interactionMapMemoized = useMemo<InteractionMapItem[]>(
    () => interactionMap.map((item) => ({ ...item, ownerId: mapIdMemoized })),
    deps
  )

  useEffect(() => {
    interactionMachine.send({
      type: 'Add to interaction map',
      data: interactionMapMemoized,
    })

    return () => {
      interactionMachine.send({
        type: 'Remove from interaction map',
        data: mapIdMemoized,
      })
    }
  }, [interactionMapMemoized, mapIdMemoized])
}
