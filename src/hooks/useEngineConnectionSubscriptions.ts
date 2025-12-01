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
  engineCommandManager,
  kclManager,
  sceneInfra,
  rustContext,
} from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!engineCommandManager) return

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
            kclManager.setHighlightRange(codeRefs.map(({ range }) => range))
          }
        } else if (
          !kclManager.highlightRange ||
          (kclManager.highlightRange[0] &&
            kclManager.highlightRange[0][0] !== 0 &&
            kclManager.highlightRange[0][1] !== 0)
        ) {
          kclManager.setHighlightRange([defaultSourceRange()])
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
  }, [engineCommandManager, context?.sketchEnginePathId])

  useEffect(() => {
    if (!engineCommandManager) return

    const unSub = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: state.matches('Sketch no face')
        ? ({ data }) => {
            void selectSketchPlane(
              data.entity_id,
              context.store.useNewSketchMode?.current
            )
          }
        : () => {},
    })
    return unSub
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [engineCommandManager, state])

  // Re-apply plane visibility when planes are (re)created on the Rust side
  useEffect(() => {
    const unsubscribe = rustContext.planesCreated.add(() => {
      const vis = stateRef.current.context.defaultPlaneVisibility
      void kclManager.setPlaneVisibilityByKey('xy', vis.xy)
      void kclManager.setPlaneVisibilityByKey('xz', vis.xz)
      void kclManager.setPlaneVisibilityByKey('yz', vis.yz)
    })
    return unsubscribe
  }, [])
}

export async function selectSketchPlane(
  planeOrFaceId: string | undefined,
  useNewSketchMode: boolean | undefined
) {
  try {
    if (!planeOrFaceId) return

    if (useNewSketchMode) {
      sceneInfra.modelingSend({
        type: 'Select sketch solve plane',
        data: planeOrFaceId,
      })
      return
    }

    const defaultSketchPlaneSelected = selectDefaultSketchPlane(planeOrFaceId)
    if (!err(defaultSketchPlaneSelected) && defaultSketchPlaneSelected) {
      return
    }

    const artifact = kclManager.artifactGraph.get(planeOrFaceId)
    const offsetPlaneSelected = await selectOffsetSketchPlane(artifact)
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
  } catch (err) {
    reportRejection(err)
  }
}
