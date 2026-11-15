import type { ModelingMachineContextValue } from '@src/machines/modelingMachineContext'
import { defaultSourceRange } from '@src/lang/sourceRange'
import type { SourceRange } from '@src/lang/wasm'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { selectSketchPlane } from '@src/lib/selectSketchPlane'
import {
  engineTopologyFallbackFromReference,
  getCodeRefsFromEntityReference,
  getEventForQueryEntityTypeWithPoint,
  normalizeEntityReference,
  showSketchOnImportForFace,
} from '@src/lib/selections'
import { reportRejection } from '@src/lib/trap'
import { isArray, uuidv4 } from '@src/lib/utils'

/** Both routes subscribe through the same selection/plane interpretation, with a live snapshot supplied by their actor owner. */
export function bindEngineConnectionSubscriptions({
  context,
  send,
  getState,
  acceptsPick = () => true,
}: {
  context: ModelingMachineContextValue['context']
  send: ModelingMachineContextValue['send']
  getState: () => ModelingMachineContextValue['state']
  acceptsPick?: () => boolean
}) {
  const { engineCommandManager, kclManager, rustContext, wasmInstance } =
    context
  const stateRef = {
    get current() {
      return getState()
    },
  }
  let disposed = false
  const hoverFrameRef = { current: null as number | null }
  const hoveredEntityIdRef = { current: null as string | null }
  const resolvedEntityIdRef = { current: null as string | null }
  const pendingEntityIdRef = { current: null as string | null }
  const hoverRequestTokenRef = { current: 0 }
  const hoverOwnerRef = {
    current: {
      connection: engineCommandManager.connection,
      graph: kclManager.artifactGraph,
    },
  }

  if (!engineCommandManager) return

  const clearHoverFrame = () => {
    if (hoverFrameRef.current !== null) {
      cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
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
    const connection = engineCommandManager.connection
    const graph = kclManager.artifactGraph
    try {
      let res = await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'query_entity_type',
          entity_id: entityId,
        },
        cmd_id: uuidv4(),
      })

      if (
        hoverRequestTokenRef.current !== requestToken ||
        hoveredEntityIdRef.current !== entityId ||
        engineCommandManager.connection !== connection ||
        kclManager.artifactGraph !== graph
      ) {
        return
      }

      if (!res) {
        applyHoverReference(undefined)
        resolvedEntityIdRef.current = entityId
        return
      }

      if (isArray(res)) {
        res = res[0]
      }

      if (isModelingResponse(res)) {
        const mr = res.resp.data.modeling_response
        if (mr.type === 'query_entity_type') {
          applyHoverReference(mr.data?.reference)
          resolvedEntityIdRef.current = entityId
          return
        }
      }

      applyHoverReference(undefined)
      resolvedEntityIdRef.current = entityId
    } finally {
      // A rejected query must be retryable, but an old owner's completion
      // must not release a newer request for the same entity.
      if (hoverRequestTokenRef.current === requestToken) {
        pendingEntityIdRef.current = null
      }
    }
  }

  const unSubHover = engineCommandManager.subscribeToUnreliable({
    // Coalesce pointer samples into the entity actually hovered this frame.
    event: 'highlight_set_entity',
    callback: ({ data }) => {
      const owner = hoverOwnerRef.current
      if (
        owner.connection !== engineCommandManager.connection ||
        owner.graph !== kclManager.artifactGraph
      ) {
        hoverRequestTokenRef.current += 1
        hoveredEntityIdRef.current = null
        resolvedEntityIdRef.current = null
        pendingEntityIdRef.current = null
        hoverOwnerRef.current = {
          connection: engineCommandManager.connection,
          graph: kclManager.artifactGraph,
        }
        clearHoverFrame()
        clearHoverRanges()
      }
      const entityId =
        data?.entity_id && typeof data.entity_id === 'string'
          ? data.entity_id
          : null

      if (!entityId) {
        hoverRequestTokenRef.current += 1
        hoveredEntityIdRef.current = null
        resolvedEntityIdRef.current = null
        pendingEntityIdRef.current = null
        clearHoverFrame()
        clearHoverRanges()
        return
      }

      if (hoveredEntityIdRef.current === entityId) {
        if (
          resolvedEntityIdRef.current === entityId ||
          pendingEntityIdRef.current === entityId ||
          hoverFrameRef.current !== null
        ) {
          return
        }
      } else {
        hoverRequestTokenRef.current += 1
        hoveredEntityIdRef.current = entityId
        resolvedEntityIdRef.current = null
        pendingEntityIdRef.current = null
        clearHoverFrame()
      }

      const requestToken = hoverRequestTokenRef.current
      const connection = engineCommandManager.connection
      hoverFrameRef.current = requestAnimationFrame(() => {
        hoverFrameRef.current = null
        if (engineCommandManager.connection !== connection) return
        const graph = kclManager.artifactGraph
        const artifact = graph.get(entityId)
        // Rust creates wall/cap artifacts with the engine face ID. The
        // highlight response already identifies that face, so resolving its
        // source ranges needs no second engine round trip. Other topology
        // still needs the query's edge/vertex/import reference information.
        if (artifact?.type === 'wall' || artifact?.type === 'cap') {
          const refs = getCodeRefsFromEntityReference(
            { type: 'face', face_id: entityId },
            graph
          )
          if (refs?.length) {
            kclManager.setHighlightRange(refs.map((ref) => ref.range))
            resolvedEntityIdRef.current = entityId
            return
          }
        }
        pendingEntityIdRef.current = entityId
        void queryHoverReference(entityId, requestToken).catch(reportRejection)
      })
    },
  })
  const unSubClick = engineCommandManager.subscribeTo({
    event: 'query_entity_type_with_point',
    callback: (engineEvent) => {
      if (disposed || !acceptsPick()) return
      const selectingSketchPlane = stateRef.current.matches('Sketch no face')
      const isSketchSolveMode = stateRef.current.matches('sketchSolveMode')

      if (isSketchSolveMode) {
        return
      }

      // Handle sketch plane selection directly when in 'Sketch no face' state
      if (selectingSketchPlane) {
        ;(async () => {
          if (!engineEvent || !('data' in engineEvent)) return
          const data = engineEvent.data as { reference?: unknown } | undefined
          if (!data?.reference) return

          const entityRef = normalizeEntityReference(data.reference)
          if (!entityRef) return

          const event = await getEventForQueryEntityTypeWithPoint(engineEvent, {
            engineCommandManager,
            kclManager,
            rustContext,
            wasmInstance,
          })
          if (disposed || !stateRef.current.matches('Sketch no face')) return
          if (disposed) return
          if (event) send(event)

          const topology = engineTopologyFallbackFromReference(data.reference)
          if (
            entityRef.type === 'face' &&
            topology &&
            showSketchOnImportForFace(
              topology.parentId,
              kclManager.artifactGraph,
              kclManager.astSignal.value,
              wasmInstance
            )
          ) {
            return
          }

          const planeId =
            entityRef.type === 'plane'
              ? entityRef.plane_id
              : entityRef.type === 'face'
                ? ((engineEvent.data as { entity_id?: string }).entity_id ??
                  entityRef.face_id)
                : undefined
          if (!planeId) return

          selectSketchPlane(planeId, kclManager)
        })().catch(reportRejection)
        return
      }
      // Normal flow for other states
      ;(async () => {
        const event = await getEventForQueryEntityTypeWithPoint(engineEvent, {
          engineCommandManager,
          kclManager,
          rustContext,
          wasmInstance,
        })
        // Check state again, in case it changed before
        // getEventForQueryEntityTypeWithPoint returned.
        if (
          stateRef.current.matches('sketchSolveMode') ||
          selectingSketchPlane !== stateRef.current.matches('Sketch no face')
        ) {
          return
        }
        if (disposed) return
        if (event) send(event)
        if (selectingSketchPlane) {
          const entityId = (
            engineEvent.data as typeof engineEvent.data & {
              entity_id?: string
            }
          ).entity_id
          if (entityId) {
            selectSketchPlane(entityId, kclManager)
          }
        }
      })().catch(reportRejection)
    },
  })
  const stopHover = () => {
    clearHoverFrame()
    hoverRequestTokenRef.current += 1
    hoveredEntityIdRef.current = null
    resolvedEntityIdRef.current = null
    pendingEntityIdRef.current = null
    unSubHover()
    unSubClick()
  }

  const unsubscribe = rustContext.planesCreated.add(() => {
    const vis = stateRef.current.context.defaultPlaneVisibility
    void kclManager.setPlaneVisibilityByKey('xy', vis.xy)
    void kclManager.setPlaneVisibilityByKey('xz', vis.xz)
    void kclManager.setPlaneVisibilityByKey('yz', vis.yz)
  })
  return () => {
    disposed = true
    stopHover()
    unsubscribe()
  }
}

export { selectSketchPlane }
