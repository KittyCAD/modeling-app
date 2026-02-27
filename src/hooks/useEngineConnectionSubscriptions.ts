import { useEffect, useRef } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { defaultSourceRange } from '@src/lang/sourceRange'
import {
  getCodeRefsFromEntityReference,
  getEventForQueryEntityTypeWithPoint,
  normalizeEntityReference,
  selectDefaultSketchPlane,
  selectionBodyFace,
  selectOffsetSketchPlane,
} from '@src/lib/selections'
import { err, reportRejection } from '@src/lib/trap'
import type { KclManager } from '@src/lang/KclManager'
import type { SourceRange } from '@src/lang/wasm'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()
  const {
    engineCommandManager,
    kclManager,
    rustContext,
    sceneEntitiesManager,
    sceneInfra,
  } = context
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!engineCommandManager) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      // Note this is our hover logic, "highlight_query_entity" is the event that is fired when we hover over an entity
      event: 'highlight_query_entity' as any, // TODO: Add to generated types
      callback: ({ data }: { data: any }) => {
        if (data?.reference) {
          // Map from engine format to frontend format
          const entityRef = normalizeEntityReference(data.reference)
          if (!entityRef) {
            kclManager.setHighlightRange([defaultSourceRange()])
            return
          }
          const codeRefs = getCodeRefsFromEntityReference(
            entityRef,
            kclManager.artifactGraph
          )
          if (codeRefs && codeRefs.length > 0) {
            const ranges = codeRefs.map(
              (codeRef: { range: SourceRange }) => codeRef.range
            )
            kclManager.setHighlightRange(ranges)
          } else {
            kclManager.setHighlightRange([defaultSourceRange()])
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
      event: 'query_entity_type_with_point' as any, // TODO: Add to generated types when OpenAPI spec is updated
      callback: (engineEvent) => {
        const isSketchNoFace = stateRef.current.matches('Sketch no face')

        // Handle sketch plane selection directly when in 'Sketch no face' state
        if (isSketchNoFace) {
          if (!engineEvent || !('data' in engineEvent)) return
          const data = engineEvent.data as { reference?: any } | undefined
          if (!data?.reference) return

          const entityRef = normalizeEntityReference(data.reference)
          if (!entityRef) return

          // Extract plane ID from EntityReference
          let planeId: string | undefined
          if (entityRef.type === 'plane') {
            planeId = entityRef.plane_id
          } else if (entityRef.type === 'face') {
            // Check if it's a default plane
            const entityId = entityRef.face_id
            const foundDefaultPlane =
              entityId &&
              rustContext.defaultPlanes !== null &&
              Object.entries(rustContext.defaultPlanes).find(
                ([, plane]) => plane === entityId
              )
            if (foundDefaultPlane) {
              planeId = entityId
            } else {
              // Regular face - use faceId
              planeId = entityId
            }
          }

          if (planeId) {
            void selectSketchPlane(
              planeId,
              context.store.useNewSketchMode?.current,
              {
                kclManager,
                rustContext,
                sceneEntitiesManager,
                sceneInfra,
              }
            )
          }
          return
        }

        // Normal flow for other states
        void getEventForQueryEntityTypeWithPoint(engineEvent, {
          rustContext,
          artifactGraph: kclManager.artifactGraph,
        })
          .then((event) => {
            if (event) {
              send(event)
            }
          })
          .catch(reportRejection)
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [
    context?.sketchEnginePathId,
    context.store.useNewSketchMode,
    kclManager,
    send,
    engineCommandManager,
    rustContext,
    sceneEntitiesManager,
    sceneInfra,
  ])

  useEffect(() => {
    if (!engineCommandManager) return

    const unSub = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: state.matches('Sketch no face')
        ? ({ data }) => {
            void selectSketchPlane(
              data.entity_id,
              context.store.useNewSketchMode?.current,
              {
                kclManager,
                rustContext,
                sceneEntitiesManager,
                sceneInfra,
              }
            )
          }
        : () => {},
    })
    return unSub
  }, [
    context.store.useNewSketchMode,
    state,
    kclManager,
    sceneInfra,
    rustContext,
    engineCommandManager,
    sceneEntitiesManager,
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
  useNewSketchMode: boolean | undefined,
  systemDeps?: {
    kclManager: KclManager
    sceneInfra: SceneInfra
    rustContext: RustContext
    sceneEntitiesManager: SceneEntities
  }
) {
  try {
    if (!systemDeps) return
    if (!planeOrFaceId) return

    if (useNewSketchMode) {
      systemDeps.sceneInfra.modelingSend({
        type: 'Select sketch solve plane',
        data: planeOrFaceId,
      })
      return
    }

    const defaultSketchPlaneSelected = selectDefaultSketchPlane(
      planeOrFaceId,
      systemDeps
    )
    if (!err(defaultSketchPlaneSelected) && defaultSketchPlaneSelected) {
      return
    }

    const artifact = systemDeps.kclManager.artifactGraph.get(planeOrFaceId)
    const offsetPlaneSelected = await selectOffsetSketchPlane(
      artifact,
      systemDeps
    )
    if (!err(offsetPlaneSelected) && offsetPlaneSelected) {
      return
    }

    const sweepFaceSelected = await selectionBodyFace(
      planeOrFaceId,
      systemDeps.kclManager.artifactGraph,
      systemDeps.kclManager.ast,
      systemDeps.kclManager.execState,
      {
        ...systemDeps,
        wasmInstance: await systemDeps.kclManager.wasmInstancePromise,
      }
    )
    if (sweepFaceSelected) {
      systemDeps.sceneInfra.modelingSend({
        type: 'Select sketch plane',
        data: sweepFaceSelected,
      })
    }
  } catch (err) {
    reportRejection(err)
  }
}
