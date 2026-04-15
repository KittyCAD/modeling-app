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
import { err, reportRejection } from '@src/lib/trap'
import type { KclManager } from '@src/lang/KclManager'

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()
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
            stateRef.current.matches('Sketch no face') ||
            // Ignore select_with_point in sketch solve: without this selection is overridden
            // and breaks multiple line highlights
            stateRef.current.matches('sketchSolveMode')
          ) {
            return
          }
          const event = await getEventForSelectWithPoint(engineEvent, {
            engineCommandManager,
            kclManager,
            rustContext,
            wasmInstance,
          })
          // Check state again, in case we went into sketch mode before getEventForSelectWithPoint returned.
          // This is probably rare, but we do go into sketch mode on double click.
          if (
            stateRef.current.matches('Sketch no face') ||
            stateRef.current.matches('sketchSolveMode')
          ) {
            return
          }
          if (event) send(event)
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

export async function selectSketchPlane(
  planeOrFaceId: string | undefined,
  useSketchSolveMode: boolean | undefined,
  kclManager?: KclManager
) {
  try {
    if (!kclManager) return
    if (!planeOrFaceId) return

    if (useSketchSolveMode) {
      kclManager.sceneInfra.modelingSend({
        type: 'Select sketch solve plane',
        data: planeOrFaceId,
      })
      return
    }

    const defaultSketchPlaneSelected = selectDefaultSketchPlane(planeOrFaceId, {
      sceneInfra: kclManager.sceneInfra,
      rustContext: kclManager.rustContext,
    })
    if (!err(defaultSketchPlaneSelected) && defaultSketchPlaneSelected) {
      return
    }

    const artifact = kclManager.artifactGraph.get(planeOrFaceId)
    const offsetPlaneSelected = await selectOffsetSketchPlane(artifact, {
      sceneInfra: kclManager.sceneInfra,
      sceneEntitiesManager: kclManager.sceneEntitiesManager,
    })
    if (!err(offsetPlaneSelected) && offsetPlaneSelected) {
      return
    }

    const sweepFaceSelected = await selectionBodyFace(
      planeOrFaceId,
      kclManager.artifactGraph,
      kclManager.ast,
      kclManager.execState,
      {
        rustContext: kclManager.rustContext,
        sceneInfra: kclManager.sceneInfra,
        sceneEntitiesManager: kclManager.sceneEntitiesManager,
        wasmInstance: await kclManager.wasmInstancePromise,
      }
    )
    if (sweepFaceSelected) {
      kclManager.sceneInfra.modelingSend({
        type: 'Select sketch plane',
        data: sweepFaceSelected,
      })
    }
  } catch (err) {
    reportRejection(err)
  }
}
