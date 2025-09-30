import { useEffect, useRef } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { defaultSourceRange } from '@src/lang/sourceRange'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import {
  getEventForSelectWithPoint,
  selectDefaultSketchPlane,
  selectionBodyFace,
  selectOffsetSketchPlane,
} from '@src/lib/selections'
import {
  editorManager,
  engineCommandManager,
  kclManager,
  sceneInfra,
} from '@src/lib/singletons'
import { engineStreamActor } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { EngineStreamState } from '@src/machines/engineStreamMachine'

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()
  const stateRef = useRef(state)
  stateRef.current = state

  const engineStreamState = engineStreamActor.getSnapshot()

  useEffect(() => {
    if (!engineCommandManager) return
    if (engineStreamState.value !== EngineStreamState.Playing) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      // Note this is our hover logic, "highlight_set_entity" is the event that is fired when we hover over an entity
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const codeRefs = getCodeRefsByArtifactId(
            data.entity_id,
            kclManager.artifactGraph
          )
          if (codeRefs) {
            editorManager.setHighlightRange(codeRefs.map(({ range }) => range))
          }
        } else if (
          !editorManager.highlightRange ||
          (editorManager.highlightRange[0] &&
            editorManager.highlightRange[0][0] !== 0 &&
            editorManager.highlightRange[0][1] !== 0)
        ) {
          editorManager.setHighlightRange([defaultSourceRange()])
        }
      },
    })
    const unSubClick = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: (engineEvent) => {
        ;(async () => {
          if (stateRef.current.matches('Sketch no face')) return
          const event = await getEventForSelectWithPoint(engineEvent)
          event && send(event)
        })().catch(reportRejection)
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [engineCommandManager, engineStreamState, context?.sketchEnginePathId])

  useEffect(() => {
    if (!engineCommandManager) return
    if (engineStreamState.value !== EngineStreamState.Playing) return

    const unSub = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: state.matches('Sketch no face')
        ? ({ data }) => {
            ;(async () => {
              let planeOrFaceId = data.entity_id
              if (!planeOrFaceId) return

              if (context.store.useNewSketchMode?.current) {
                sceneInfra.modelingSend({
                  type: 'Select sketch solve plane',
                  data: planeOrFaceId,
                })
                return
              }

              const defaultSketchPlaneSelected =
                selectDefaultSketchPlane(planeOrFaceId)
              if (
                !err(defaultSketchPlaneSelected) &&
                defaultSketchPlaneSelected
              ) {
                return
              }

              const artifact = kclManager.artifactGraph.get(planeOrFaceId)
              const offsetPlaneSelected =
                await selectOffsetSketchPlane(artifact)
              if (!err(offsetPlaneSelected) && offsetPlaneSelected) {
                return
              }

              const sweepFaceSelected = await selectionBodyFace(planeOrFaceId)
              if (sweepFaceSelected) {
                sceneInfra.modelingSend({
                  type: 'Select sketch plane',
                  data: sweepFaceSelected,
                })
              }
              return
            })().catch(reportRejection)
          }
        : () => {},
    })
    return unSub
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [engineCommandManager, engineStreamState, state])
}
