import { useEffect } from 'react'
import { editorManager, engineCommandManager } from 'lib/singletons'
import { useModelingContext } from './useModelingContext'
import { getEventForSelectWithPoint } from 'lib/selections'
import {
  getCapCodeRef,
  getExtrusionFromSuspectedExtrudeSurface,
  getSolid2dCodeRef,
  getWallCodeRef,
} from 'lang/std/artifactGraph'
import { err } from 'lib/trap'

export function useEngineConnectionSubscriptions() {
  const { send, context } = useModelingContext()

  useEffect(() => {
    if (!engineCommandManager) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      // Note this is our hover logic, "highlight_set_entity" is the event that is fired when we hover over an entity
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const artifact = engineCommandManager.artifactGraph.get(
            data.entity_id
          )
          if (artifact?.type === 'solid2D') {
            const codeRef = getSolid2dCodeRef(
              artifact,
              engineCommandManager.artifactGraph
            )
            if (err(codeRef)) return
            editorManager.setHighlightRange([codeRef.range])
          } else if (artifact?.type === 'cap') {
            const codeRef = getCapCodeRef(
              artifact,
              engineCommandManager.artifactGraph
            )
            if (err(codeRef)) return
            editorManager.setHighlightRange([codeRef.range])
          } else if (artifact?.type === 'wall') {
            const extrusion = getExtrusionFromSuspectedExtrudeSurface(
              data.entity_id,
              engineCommandManager.artifactGraph
            )
            const codeRef = getWallCodeRef(
              artifact,
              engineCommandManager.artifactGraph
            )
            if (err(codeRef)) return
            editorManager.setHighlightRange(
              err(extrusion)
                ? [codeRef.range]
                : [codeRef.range, extrusion.codeRef.range]
            )
          } else if (artifact?.type === 'segment') {
            editorManager.setHighlightRange([
              artifact?.codeRef?.range || [0, 0],
            ])
          } else {
            editorManager.setHighlightRange([[0, 0]])
          }
        } else if (
          !editorManager.highlightRange ||
          (editorManager.highlightRange[0][0] !== 0 &&
            editorManager.highlightRange[0][1] !== 0)
        ) {
          editorManager.setHighlightRange([[0, 0]])
        }
      },
    })
    const unSubClick = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: async (engineEvent) => {
        const event = await getEventForSelectWithPoint(engineEvent)
        event && send(event)
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [engineCommandManager, context?.sketchEnginePathId])
}
