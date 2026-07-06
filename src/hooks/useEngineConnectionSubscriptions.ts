import { useEffect, useRef } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { defaultSourceRange } from '@src/lang/sourceRange'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import { useApp } from '@src/lib/boot'
import { SEGMENTS_BASED_REGIONS_FEATURE_FLAG } from '@src/lib/constants'
import {
  getEventForSelectWithPoint,
  selectSketchPlane,
} from '@src/lib/selections'
import { reportRejection } from '@src/lib/trap'

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()
  const { userFeatures } = useApp()
  const useSegmentsBasedRegions = userFeatures.useHas(
    SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
    false
  )
  const { engineCommandManager, kclManager, rustContext, wasmInstance } =
    context
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!engineCommandManager) return

    const shouldAllowSelectWithPointInCurrentState = (
      entityId: string | undefined
    ) => {
      if (!entityId) {
        return !(
          stateRef.current.matches('Sketch no face') ||
          stateRef.current.matches('sketchSolveMode')
        )
      }

      const artifact = kclManager.artifactGraph.get(entityId)
      const isSegmentSelection = artifact?.type === 'segment'

      if (stateRef.current.matches('Sketch no face')) {
        return isSegmentSelection
      }

      if (stateRef.current.matches('sketchSolveMode')) {
        return isSegmentSelection
      }

      return true
    }

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
          if (
            !shouldAllowSelectWithPointInCurrentState(
              engineEvent.data.entity_id
            )
          ) {
            return
          }
          const event = await getEventForSelectWithPoint(engineEvent, {
            engineCommandManager,
            kclManager,
            rustContext,
            wasmInstance,
            useSegmentsBasedRegions,
          })
          // Check state again, in case we went into sketch mode before getEventForSelectWithPoint returned.
          // This is probably rare, but we do go into sketch mode on double click.
          if (
            !shouldAllowSelectWithPointInCurrentState(
              engineEvent.data.entity_id
            )
          ) {
            return
          }
          if (event) {
            send(event)
          }
        })().catch(reportRejection)
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [
    context?.sketchEnginePathId,
    kclManager,
    send,
    engineCommandManager,
    rustContext,
    wasmInstance,
    useSegmentsBasedRegions,
  ])

  useEffect(() => {
    if (!engineCommandManager) return

    const unSub = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: state.matches('Sketch no face')
        ? ({ data }) => {
            void selectSketchPlane(
              data.entity_id,
              context.store.useSketchSolveMode?.current,
              kclManager
            )
          }
        : () => {},
    })
    return unSub
  }, [
    context.store.useSketchSolveMode,
    state,
    kclManager,
    rustContext,
    engineCommandManager,
  ])

  // Re-apply plane visibility when planes are (re)created on the Rust side
  useEffect(() => {
    const unsubscribe = rustContext.planesCreated.add(() => {
      const vis = stateRef.current.context.defaultPlaneVisibility
      void kclManager.setPlaneVisibilityByKey('xy', vis.xy)
      void kclManager.setPlaneVisibilityByKey('xz', vis.xz)
      void kclManager.setPlaneVisibilityByKey('yz', vis.yz)
    })
    return unsubscribe
  }, [kclManager, rustContext])
}
