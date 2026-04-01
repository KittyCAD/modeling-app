import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import {
  type ActionArgs,
  type AssignArgs,
  type ProvidedActor,
  type DoneActorEvent,
} from 'xstate'
import { roundOff } from '@src/lib/utils'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  getCoincidentCluster,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import {
  allowSnapping,
  getSnappingCandidates,
  isPointSnapTarget,
} from '@src/machines/sketchSolve/snapping'
import {
  hideSnappingPreviewSprite,
  updateSnappingPreviewSprite,
} from '@src/machines/sketchSolve/snappingPreviewSprite'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import { Group } from 'three'

export const TOOL_ID = 'Line tool'
export const CONFIRMING_DIMENSIONS = 'Confirming dimensions'

export type ToolEvents =
  | BaseToolEvent
  | { type: 'finish line chain' }
  | { type: 'start next draft line'; data: [number, number] }
  | {
      type:
        | `xstate.done.actor.0.${typeof TOOL_ID}.Adding point`
        | `xstate.done.actor.0.${typeof TOOL_ID}.${typeof CONFIRMING_DIMENSIONS}`
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

export type ToolContext = {
  draftPointId?: number
  pendingSketchOutcome?: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    // If present, the next draft line should chain from this committed point.
    // When double-clicking or snapping to a point it becomes undefined to stop chaining.
    lastPointId?: number
  }
  deleteFromEscape?: boolean // Track if deletion was triggered by escape (vs unequip)
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
}

export type ToolActionArgs = ActionArgs<ToolContext, ToolEvents, ToolEvents>

type ToolAssignArgs<TActor extends ProvidedActor = any> = AssignArgs<
  ToolContext,
  ToolEvents,
  ToolEvents,
  TActor
>

function sendHoveredId(self: ToolActionArgs['self'], hoveredId: number | null) {
  self._parent?.send({
    type: 'update hovered id',
    data: {
      hoveredId,
    },
  })
}

// Don't snap to the current draft point and the opposite point's cluster.
function getSnappingExcludedPointIds(
  objects: ApiObject[],
  draftPointId?: number
) {
  const excludedPointIds = new Set<number>()
  if (draftPointId === undefined) {
    return excludedPointIds
  }

  excludedPointIds.add(draftPointId)

  const draftLine = objects.find(
    (obj) =>
      isLineSegment(obj) &&
      (obj.kind.segment.start === draftPointId ||
        obj.kind.segment.end === draftPointId)
  )

  if (isLineSegment(draftLine)) {
    const fixedPointId =
      draftLine.kind.segment.start === draftPointId
        ? draftLine.kind.segment.end
        : draftLine.kind.segment.start

    getCoincidentCluster(fixedPointId, objects).forEach((pointId) => {
      excludedPointIds.add(pointId)
    })
  }

  return excludedPointIds
}

function getBestSnappingCandidate({
  self,
  context,
  mousePosition,
  mouseEvent,
}: {
  self: ToolActionArgs['self']
  context: ToolContext
  mousePosition: Coords2d
  mouseEvent: MouseEvent
}) {
  if (!allowSnapping(mouseEvent)) {
    return null
  }

  const snapshot = self._parent?.getSnapshot()
  const sceneGraphDelta = snapshot?.context?.sketchExecOutcome?.sceneGraphDelta
  const objects = sceneGraphDelta?.new_graph?.objects
  if (!objects) {
    return null
  }

  const currentSketchObjects = getCurrentSketchObjectsById(
    objects,
    context.sketchId
  )
  const excludedPointIds = getSnappingExcludedPointIds(
    currentSketchObjects,
    context.draftPointId
  )

  return (
    getSnappingCandidates(
      mousePosition,
      currentSketchObjects,
      context.sceneInfra
    ).find(
      (candidate) =>
        !isPointSnapTarget(candidate.target) ||
        !excludedPointIds.has(candidate.target.pointId)
    ) ?? null
  )
}

function updateSnappingPreview({
  context,
  snappingCandidate,
}: {
  context: ToolContext
  snappingCandidate: ReturnType<typeof getBestSnappingCandidate>
}) {
  const sketchSolveGroup =
    context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  if (!(sketchSolveGroup instanceof Group)) {
    return
  }

  updateSnappingPreviewSprite({
    sketchSolveGroup,
    sceneInfra: context.sceneInfra,
    targetPosition: isPointSnapTarget(snappingCandidate?.target)
      ? snappingCandidate.position
      : null,
  })
}

////////////// --Actions-- //////////////////

export function animateDraftSegmentListener({ self, context }: ToolActionArgs) {
  let isEditInProgress = false
  context.sceneInfra.setCallbacks({
    onMove: async (args) => {
      if (!args || !context.draftPointId) return
      const twoD = args.intersectionPoint?.twoD
      if (twoD && !isEditInProgress) {
        const mousePosition = [twoD.x, twoD.y] as Coords2d
        const snappingCandidate = getBestSnappingCandidate({
          self,
          context,
          mousePosition,
          mouseEvent: args.mouseEvent,
        })
        sendHoveredId(
          self,
          isPointSnapTarget(snappingCandidate?.target)
            ? snappingCandidate.target.pointId
            : null
        )
        updateSnappingPreview({ context, snappingCandidate })

        const units = baseUnitToNumericSuffix(
          context.kclManager.fileSettings.defaultLengthUnit
        )
        try {
          isEditInProgress = true
          const settings = jsAppSettings(context.rustContext.settingsActor)
          // Note: twoD comes from intersectionPoint.unscaledTwoD which is in world coordinates, and always mm
          const result = await context.rustContext.editSegments(
            0,
            context.sketchId,
            [
              {
                id: context.draftPointId,
                ctor: {
                  type: 'Point',
                  position: {
                    x: {
                      type: 'Var',
                      value: roundOff(twoD.x),
                      units,
                    },
                    y: {
                      type: 'Var',
                      value: roundOff(twoD.y),
                      units,
                    },
                  },
                },
              },
            ],
            settings
          )
          const sendData: SketchSolveMachineEvent = {
            type: 'update sketch outcome',
            data: {
              sourceDelta: result.kclSource,
              sceneGraphDelta: result.sceneGraphDelta,
              writeToDisk: false,
            },
          }
          self._parent?.send(sendData)
          await new Promise((resolve) => requestAnimationFrame(resolve))
        } catch (err) {
          console.error('failed to edit segment', err)
        } finally {
          isEditInProgress = false
        }
      }
    },
    onClick: async (args) => {
      if (!args || !context.draftPointId) return
      const twoD = args.intersectionPoint?.twoD
      if (twoD) {
        const mousePosition = [twoD.x, twoD.y] as Coords2d
        const snappingCandidate = getBestSnappingCandidate({
          self,
          context,
          mousePosition,
          mouseEvent: args.mouseEvent,
        })
        const [x, y] = isPointSnapTarget(snappingCandidate?.target)
          ? snappingCandidate.position
          : mousePosition
        console.log('line tool snap target', snappingCandidate?.target ?? null)
        self.send({
          type: 'add point',
          data: [x, y],
          id: context.draftPointId,
          snapTargetId: isPointSnapTarget(snappingCandidate?.target)
            ? snappingCandidate.target.pointId
            : undefined,
          isDoubleClick: args.mouseEvent.detail === 2,
        })
      }
    },
  })
}

export function addPointListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args) return
      if (args.mouseEvent.which !== 1) return // Only left click

      const twoD = args.intersectionPoint?.twoD
      if (twoD) {
        const mousePosition = [twoD.x, twoD.y] as Coords2d
        const snappingCandidate = getBestSnappingCandidate({
          self,
          context,
          mousePosition,
          mouseEvent: args.mouseEvent,
        })
        const [x, y] = isPointSnapTarget(snappingCandidate?.target)
          ? snappingCandidate.position
          : mousePosition
        console.log('line tool snap target', snappingCandidate?.target ?? null)
        self.send({
          type: 'add point',
          data: [x, y],
          snapTargetId: isPointSnapTarget(snappingCandidate?.target)
            ? snappingCandidate.target.pointId
            : undefined,
        })
      }
    },
    onMove: (args) => {
      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) {
        sendHoveredId(self, null)
        updateSnappingPreview({ context, snappingCandidate: null })
        return
      }

      const snappingCandidate = getBestSnappingCandidate({
        self,
        context,
        mousePosition: [twoD.x, twoD.y],
        mouseEvent: args.mouseEvent,
      })
      sendHoveredId(
        self,
        isPointSnapTarget(snappingCandidate?.target)
          ? snappingCandidate.target.pointId
          : null
      )
      updateSnappingPreview({ context, snappingCandidate })
    },
  })
}

export function addNextDraftLineListener({ self, context }: ToolActionArgs) {
  let hasStartedNextDraftLine = false
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) return
      if (args.mouseEvent.detail === 2) {
        self.send({ type: 'finish line chain' })
      }
    },
    onMove: (args) => {
      if (hasStartedNextDraftLine) return

      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) return

      hasStartedNextDraftLine = true
      self.send({
        type: 'start next draft line',
        data: [twoD.x, twoD.y],
      })
    },
  })
}

export function removePointListener({ context, self }: ToolActionArgs) {
  sendHoveredId(self, null)
  const sketchSolveGroup =
    context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  if (sketchSolveGroup instanceof Group) {
    hideSnappingPreviewSprite(sketchSolveGroup)
  }
  // Reset callbacks to remove the onClick and onMove listeners
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export function sendResultToParent({ event, self }: ToolAssignArgs<any>) {
  if (!('output' in event) || !event.output) {
    return {}
  }

  const output = event.output as {
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
    newLineEndPointId?: number
    newlyAddedEntities?: {
      segmentIds: Array<number>
      constraintIds: Array<number>
    }
    error?: string
  }

  // If there's an error, don't update context
  if (output.error) {
    return {}
  }

  if (output.kclSource && output.sceneGraphDelta) {
    const sendData: SketchSolveMachineEvent = {
      type: 'update sketch outcome',
      data: {
        sourceDelta: output.kclSource,
        sceneGraphDelta: output.sceneGraphDelta,
      },
    }
    self._parent?.send(sendData)
  }

  if (output.newLineEndPointId !== undefined) {
    if (output.newlyAddedEntities) {
      const sendData: SketchSolveMachineEvent = {
        type: 'set draft entities',
        data: output.newlyAddedEntities,
      }
      self._parent?.send(sendData)
    }

    return {
      draftPointId: output.newLineEndPointId,
    }
  }

  // For the first point creation, find the point ID normally
  const pointIds =
    output.sceneGraphDelta?.new_objects.filter((objId) => {
      const obj = output.sceneGraphDelta!.new_graph.objects[objId]
      if (!obj) return false
      return isPointSegment(obj)
    }) || []

  // The last point ID is the end point of the newly created line
  const pointId = pointIds[pointIds.length - 1]

  const lineId = [...(output.sceneGraphDelta?.new_objects || [])]
    .reverse()
    .find((objId) => {
      const obj = output.sceneGraphDelta!.new_graph.objects[objId]
      return isLineSegment(obj)
    })

  const entitiesToTrack = output.newlyAddedEntities ?? {
    segmentIds: [] as Array<number>,
    constraintIds: [] as Array<number>,
  }

  if (!output.newlyAddedEntities) {
    if (pointIds.length > 0 && output.sceneGraphDelta) {
      entitiesToTrack.segmentIds.push(...pointIds)
    }
    if (lineId !== undefined) {
      entitiesToTrack.segmentIds.push(lineId)
    }
  }

  // Send draft entities to parent for tracking
  if (entitiesToTrack.segmentIds.length > 0) {
    const sendData: SketchSolveMachineEvent = {
      type: 'set draft entities',
      data: entitiesToTrack,
    }
    self._parent?.send(sendData)
  }

  if (pointId !== undefined && output.sceneGraphDelta) {
    return {
      draftPointId: pointId,
    }
  }
  return {}
}

export function storePendingSketchOutcome({
  event,
}: {
  event: DoneActorEvent<{
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
    lastPointId?: number
    error?: string
  }>
}) {
  const output = event.output

  const result: Partial<ToolContext> = {}

  if (output.kclSource && output.sceneGraphDelta && !output.error) {
    result.pendingSketchOutcome = {
      kclSource: output.kclSource,
      sceneGraphDelta: output.sceneGraphDelta,
      lastPointId: output.lastPointId,
    }
  }

  return result
}

export function sendStoredResultToParent({ context, self }: ToolActionArgs) {
  if (context.pendingSketchOutcome) {
    const sendData: SketchSolveMachineEvent = {
      type: 'update sketch outcome',
      data: {
        sourceDelta: context.pendingSketchOutcome.kclSource,
        sceneGraphDelta: context.pendingSketchOutcome.sceneGraphDelta,
        writeToDisk: true,
      },
    }
    self._parent?.send(sendData)
    const clearData: SketchSolveMachineEvent = { type: 'clear draft entities' }
    self._parent?.send(clearData)
  }
  return {}
}
