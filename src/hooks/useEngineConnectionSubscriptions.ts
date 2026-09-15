import { useEffect, useRef } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { defaultSourceRange } from '@src/lang/sourceRange'
import {
  getCodeRefsByArtifactId,
  resolveEngineSelectionArtifact,
} from '@src/lang/std/artifactGraph'
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

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      // Note this is our hover logic, "highlight_set_entity" is the event that is fired when we hover over an entity
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const engineArtifact = kclManager.artifactGraph.get(data.entity_id)
          const semanticArtifact = engineArtifact
            ? resolveEngineSelectionArtifact(
                engineArtifact,
                kclManager.artifactGraph
              )
            : undefined
          const codeRefs = getCodeRefsByArtifactId(
            semanticArtifact?.id ?? data.entity_id,
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
          const selectingSketchPlane =
            stateRef.current.matches('Sketch no face')
          // Ignore select_with_point in sketch solve: without this selection is overridden
          // and breaks multiple line highlights
          if (stateRef.current.matches('sketchSolveMode')) {
            return
          }
          const event = await getEventForSelectWithPoint(engineEvent, {
            engineCommandManager,
            kclManager,
            rustContext,
            wasmInstance,
            useSegmentsBasedRegions,
          })
          // Check state again, in case it changed before
          // getEventForSelectWithPoint returned.
          if (
            stateRef.current.matches('sketchSolveMode') ||
            selectingSketchPlane !== stateRef.current.matches('Sketch no face')
          ) {
            return
          }
          if (event) send(event)
          if (selectingSketchPlane) {
            await selectSketchPlane(
              engineEvent.data.entity_id,
              context.store.useSketchSolveMode?.current,
              kclManager
            )
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
    context.store.useSketchSolveMode,
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
