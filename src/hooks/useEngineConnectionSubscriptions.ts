import { useEffect } from 'react'
import { editorManager, engineCommandManager } from 'lib/singletons'
import { useModelingContext } from './useModelingContext'
import { getEventForSelectWithPoint } from 'lib/selections'

export function useEngineConnectionSubscriptions() {
  const { send, context } = useModelingContext()

  useEffect(() => {
    if (!engineCommandManager) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      // Note this is our hover logic, "highlight_set_entity" is the event that is fired when we hover over an entity
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const sourceRange =
            engineCommandManager.artifactMap?.[data.entity_id]?.range
          editorManager.setHighlightRange(sourceRange)
        } else if (
          !editorManager.highlightRange ||
          (editorManager.highlightRange[0] !== 0 &&
            editorManager.highlightRange[1] !== 0)
        ) {
          editorManager.setHighlightRange([0, 0])
        }
      },
    })
    const unSubClick = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: async (engineEvent) => {
        const event = await getEventForSelectWithPoint(engineEvent, {
          sketchEnginePathId: context.sketchEnginePathId,
        })
        event && send(event)
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [engineCommandManager, context?.sketchEnginePathId])
}
