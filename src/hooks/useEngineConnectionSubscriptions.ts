import { useEffect } from 'react'
import { useStore } from 'useStore'
import { engineCommandManager } from '../lang/std/engineConnection'
import { useModelingContext } from './useModelingContext'
import { getEventForSelectWithPoint } from 'lib/selections'

export function useEngineConnectionSubscriptions() {
  const { setHighlightRange, highlightRange } = useStore((s) => ({
    setHighlightRange: s.setHighlightRange,
    highlightRange: s.highlightRange,
  }))
  const { send, context } = useModelingContext()

  useEffect(() => {
    if (!engineCommandManager) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const sourceRange =
            engineCommandManager.artifactMap?.[data.entity_id]?.range
          setHighlightRange(sourceRange)
        } else if (
          !highlightRange ||
          (highlightRange[0] !== 0 && highlightRange[1] !== 0)
        ) {
          setHighlightRange([0, 0])
        }
      },
    })
    const unSubClick = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: async (engineEvent) => {
        if (!context.sketchEnginePathId) return
        const event = await getEventForSelectWithPoint(engineEvent, {
          sketchEnginePathId: context.sketchEnginePathId,
        })
        send(event)
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [
    engineCommandManager,
    setHighlightRange,
    highlightRange,
    context.sketchEnginePathId,
  ])
}
