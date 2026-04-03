import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import {
  clearToolSnappingState,
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import {
  getCoincidentCluster,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  allowSnapping,
  getSnappingCandidates,
  isPointSnapTarget,
} from '@src/machines/sketchSolve/snapping'
import { updateSnappingPreviewSprite } from '@src/machines/sketchSolve/snappingPreviewSprite'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import { Group } from 'three'
import {
  type ActionArgs,
  type AssignArgs,
  type DoneActorEvent,
  type ProvidedActor,
} from 'xstate'

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
    // When double-clicking or snapping to a target it becomes undefined to stop chaining.
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
          sceneInfra: context.sceneInfra,
          sketchId: context.sketchId,
          mousePosition,
          mouseEvent: args.mouseEvent,
          getExcludedPointIds: (currentSketchObjects) =>
            getSnappingExcludedPointIds(
              currentSketchObjects,
              context.draftPointId
            ),
        })
        sendHoveredSnappingCandidate(self, snappingCandidate)
        updateToolSnappingPreview({
          sceneInfra: context.sceneInfra,
          target: snappingCandidate,
        })

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
          toastSketchSolveError(err)
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
          sceneInfra: context.sceneInfra,
          sketchId: context.sketchId,
          mousePosition,
          mouseEvent: args.mouseEvent,
          excludedPointIds: getSnappingExcludedPointIds(
            self._parent?.getSnapshot?.()?.context?.sketchExecOutcome
              ?.sceneGraphDelta?.new_graph?.objects ?? [],
            context.draftPointId
          ),
        })
        const [x, y] = snappingCandidate?.position ?? mousePosition
        console.log('line tool snap target', snappingCandidate?.target ?? null)
        self.send({
          type: 'add point',
          data: [x, y],
          id: context.draftPointId,
          snapTarget: snappingCandidate?.target,
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
          sceneInfra: context.sceneInfra,
          sketchId: context.sketchId,
          mousePosition,
          mouseEvent: args.mouseEvent,
          getExcludedPointIds: (currentSketchObjects) =>
            getSnappingExcludedPointIds(
              currentSketchObjects,
              context.draftPointId
            ),
        })
        const [x, y] = snappingCandidate?.position ?? mousePosition
        console.log('line tool snap target', snappingCandidate?.target ?? null)
        self.send({
          type: 'add point',
          data: [x, y],
          snapTarget: snappingCandidate?.target,
        })
      }
    },
    onMove: (args) => {
      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) {
        clearToolSnappingState({
          self,
          sceneInfra: context.sceneInfra,
        })
        return
      }

      const snappingCandidate = getBestSnappingCandidate({
        self,
        sceneInfra: context.sceneInfra,
        sketchId: context.sketchId,
        mousePosition: [twoD.x, twoD.y],
        mouseEvent: args.mouseEvent,
        getExcludedPointIds: (currentSketchObjects) =>
          getSnappingExcludedPointIds(
            currentSketchObjects,
            context.draftPointId
          ),
      })
      sendHoveredSnappingCandidate(self, snappingCandidate)
      updateToolSnappingPreview({
        sceneInfra: context.sceneInfra,
        target: snappingCandidate,
      })
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
  clearToolSnappingState({
    self,
    sceneInfra: context.sceneInfra,
  })
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
