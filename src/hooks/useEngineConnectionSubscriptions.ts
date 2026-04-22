import { useEffect, useRef } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import type { KclManager } from '@src/lang/KclManager'
import { defaultSourceRange } from '@src/lang/sourceRange'
import type { SourceRange } from '@src/lang/wasm'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import {
  getCodeRefsFromEntityReference,
  getEventForQueryEntityTypeWithPoint,
  normalizeEntityReference,
  selectDefaultSketchPlane,
  selectOffsetSketchPlane,
  selectionBodyFace,
} from '@src/lib/selections'
import { err, reportRejection } from '@src/lib/trap'
import { isArray, uuidv4 } from '@src/lib/utils'

const HOVER_ENTITY_REFERENCE_DEBOUNCE_MS = 250

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()
  const { engineCommandManager, kclManager, rustContext } = context
  const stateRef = useRef(state)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredEntityIdRef = useRef<string | null>(null)
  const resolvedEntityIdRef = useRef<string | null>(null)
  const pendingEntityIdRef = useRef<string | null>(null)
  const hoverRequestTokenRef = useRef(0)
  stateRef.current = state

  useEffect(() => {
    if (!engineCommandManager) return

    const clearHoverTimer = () => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
    }

    const clearHoverRanges = () => {
      if (
        !kclManager.highlightRange ||
        (kclManager.highlightRange[0] &&
          kclManager.highlightRange[0][0] !== 0 &&
          kclManager.highlightRange[0][1] !== 0)
      ) {
        kclManager.setHighlightRange([defaultSourceRange()])
      }
    }

    const applyHoverReference = (reference: unknown) => {
      if (reference) {
        const entityRef = normalizeEntityReference(reference)
        if (!entityRef) {
          clearHoverRanges()
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
          clearHoverRanges()
        }
        return
      }

      clearHoverRanges()
    }

    const queryHoverReference = async (
      entityId: string,
      requestToken: number
    ) => {
      let res = await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'query_entity_type' as any,
          entity_id: entityId,
        },
        cmd_id: uuidv4(),
      })

      if (
        hoverRequestTokenRef.current !== requestToken ||
        hoveredEntityIdRef.current !== entityId
      ) {
        return
      }

      pendingEntityIdRef.current = null

      if (!res) {
        applyHoverReference(undefined)
        resolvedEntityIdRef.current = entityId
        return
      }

      if (isArray(res)) {
        res = res[0]
      }

      if (isModelingResponse(res)) {
        const mr = res.resp.data.modeling_response as any
        if (mr.type === 'query_entity_type') {
          applyHoverReference(mr.data?.reference)
          resolvedEntityIdRef.current = entityId
          return
        }
      }

      applyHoverReference(undefined)
      resolvedEntityIdRef.current = entityId
    }

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      // Immediate hover now uses `highlight_set_entity` for visual feedback,
      // then requests the heavier EntityReference payload only after the hover
      // remains stable on the same entity for a short debounce window.
      event: 'highlight_set_entity',
      callback: ({ data }: { data: any }) => {
        const entityId =
          data?.entity_id && typeof data.entity_id === 'string'
            ? data.entity_id
            : null

        if (!entityId) {
          hoverRequestTokenRef.current += 1
          hoveredEntityIdRef.current = null
          resolvedEntityIdRef.current = null
          pendingEntityIdRef.current = null
          clearHoverTimer()
          clearHoverRanges()
          return
        }

        if (hoveredEntityIdRef.current === entityId) {
          if (
            resolvedEntityIdRef.current === entityId ||
            pendingEntityIdRef.current === entityId ||
            hoverTimerRef.current !== null
          ) {
            return
          }
        } else {
          hoverRequestTokenRef.current += 1
          hoveredEntityIdRef.current = entityId
          resolvedEntityIdRef.current = null
          pendingEntityIdRef.current = null
          clearHoverTimer()
        }

        const requestToken = hoverRequestTokenRef.current
        hoverTimerRef.current = setTimeout(() => {
          hoverTimerRef.current = null
          pendingEntityIdRef.current = entityId
          void queryHoverReference(entityId, requestToken).catch(
            reportRejection
          )
        }, HOVER_ENTITY_REFERENCE_DEBOUNCE_MS)
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
              kclManager
            )
          }
          return
        }

        // Normal flow for other states
        void getEventForQueryEntityTypeWithPoint(engineEvent, {
          rustContext,
          artifactGraph: kclManager.artifactGraph,
          engineCommandManager,
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
      clearHoverTimer()
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
