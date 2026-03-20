import type {
  ApiObject,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type {
  OnMoveCallbackArgs,
  SceneInfra,
} from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import {
  addVec,
  cross2d,
  distance2d,
  isValidNumber,
  normalizeVec,
  perpendicular,
  scaleVec,
  subVec,
} from '@src/lib/utils2d'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { ActionArgs, AssignArgs, ProvidedActor } from 'xstate'
import {
  isArcSegment,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'

import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'

export const TOOL_ID = 'Tangential arc tool'
export const CREATING_ARC = `xstate.done.actor.0.${TOOL_ID}.Creating arc`
export const FINALIZING_ARC = `xstate.done.actor.0.${TOOL_ID}.Finalizing arc`

const EPSILON = 1e-8

export type TangentInfo = {
  segmentId: number
  tangentStart: {
    id: number
    point: Coords2d
  }
  tangentDirection: Coords2d
}

export type ToolEvents =
  | BaseToolEvent
  | {
      type: 'select tangent info'
      data: TangentInfo
    }
  | {
      type: 'add point'
      data: Coords2d
      clickNumber?: 2
    }
  | {
      type: typeof CREATING_ARC | typeof FINALIZING_ARC
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

export type ToolContext = {
  tangentInfo?: TangentInfo
  arcId?: number
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

function isInvalidUnitVector(v: Coords2d): boolean {
  return (
    !isValidNumber(v[0]) ||
    !isValidNumber(v[1]) ||
    (Math.abs(v[0]) < EPSILON && Math.abs(v[1]) < EPSILON)
  )
}

function getPointFromObjects(
  objects: Array<ApiObject>,
  pointId: number
): Coords2d | null {
  const point = objects[pointId]
  if (point?.kind?.type !== 'Segment' || point.kind.segment.type !== 'Point') {
    return null
  }

  return [
    point.kind.segment.position.x.value,
    point.kind.segment.position.y.value,
  ]
}

function getHoverState(self: ToolActionArgs['self']): {
  sceneGraphDelta?: SceneGraphDelta
  selectedIds: Array<number>
  draftEntityIds?: Array<number>
} {
  const snapshot = self._parent?.getSnapshot()
  const selectedIds = Array.from(
    new Set([
      ...(snapshot?.context?.selectedIds ?? []),
      ...(snapshot?.context?.duringAreaSelectIds ?? []),
    ])
  )

  return {
    sceneGraphDelta: snapshot?.context?.sketchExecOutcome?.sceneGraphDelta,
    selectedIds,
    draftEntityIds: snapshot?.context?.draftEntities
      ? [...snapshot.context.draftEntities.segmentIds]
      : undefined,
  }
}

function getLineTangentDirection({
  objects,
  segmentId,
  tangentPointId,
}: {
  objects: Array<ApiObject>
  segmentId: number
  tangentPointId: number
}): Coords2d | null {
  const lineObj = objects[segmentId]
  if (!isLineSegment(lineObj)) {
    return null
  }

  const startPoint = getPointFromObjects(objects, lineObj.kind.segment.start)
  const endPoint = getPointFromObjects(objects, lineObj.kind.segment.end)
  if (!startPoint || !endPoint) {
    return null
  }

  let tangentDirection: Coords2d | null = null
  if (lineObj.kind.segment.start === tangentPointId) {
    tangentDirection = normalizeVec(subVec(startPoint, endPoint))
  } else if (lineObj.kind.segment.end === tangentPointId) {
    tangentDirection = normalizeVec(subVec(endPoint, startPoint))
  }

  if (!tangentDirection) {
    return null
  }

  if (isInvalidUnitVector(tangentDirection)) {
    return null
  }

  return tangentDirection
}

function getArcTangentDirection({
  objects,
  segmentId,
  tangentPointId,
}: {
  objects: Array<ApiObject>
  segmentId: number
  tangentPointId: number
}): Coords2d | null {
  const arcObj = objects[segmentId]
  if (!isArcSegment(arcObj)) {
    return null
  }

  const centerPoint = getPointFromObjects(objects, arcObj.kind.segment.center)
  let tangentPoint: Coords2d | null = null
  let tangentDirection: Coords2d | null = null

  if (arcObj.kind.segment.start === tangentPointId) {
    tangentPoint = getPointFromObjects(objects, arcObj.kind.segment.start)
  } else if (arcObj.kind.segment.end === tangentPointId) {
    tangentPoint = getPointFromObjects(objects, arcObj.kind.segment.end)
  }

  if (!centerPoint || !tangentPoint) {
    return null
  }

  tangentDirection = perpendicular(subVec(tangentPoint, centerPoint))
  if (arcObj.kind.segment.start === tangentPointId) {
    tangentDirection = scaleVec(tangentDirection, -1)
  }

  tangentDirection = normalizeVec(tangentDirection)
  if (isInvalidUnitVector(tangentDirection)) {
    return null
  }

  return tangentDirection
}

export function findTangentialArcCenter({
  startPoint,
  endPoint,
  tangentDirection,
}: {
  startPoint: Coords2d
  endPoint: Coords2d
  tangentDirection: Coords2d
}): Coords2d | null {
  const tangentUnit = normalizeVec(tangentDirection)
  if (isInvalidUnitVector(tangentUnit)) {
    return null
  }

  const chord = subVec(endPoint, startPoint)
  if (distance2d(startPoint, endPoint) < EPSILON) {
    return null
  }

  const normal = perpendicular(tangentUnit)
  const midpoint = scaleVec(addVec(startPoint, endPoint), 0.5)
  const bisectorDirection = perpendicular(chord)

  const midpointOffset = subVec(midpoint, startPoint)
  const denominator = cross2d(normal, bisectorDirection)
  if (Math.abs(denominator) < EPSILON) {
    return null
  }

  const t = cross2d(midpointOffset, bisectorDirection) / denominator
  return addVec(startPoint, scaleVec(normal, t))
}

// Swap start/end when the endpoint is on the right side of the tangent
// because sketch-solve arcs are interpreted CCW from start to end.
export function resolveTangentialArcEndpoints(
  tangentStartPoint: Coords2d,
  endPoint: Coords2d,
  tangentDirection: Coords2d
): {
  start: Coords2d
  end: Coords2d
  swapped: boolean
} {
  const chord = subVec(endPoint, tangentStartPoint)
  const swapped = cross2d(tangentDirection, chord) < -EPSILON
  return {
    swapped,
    start: swapped ? endPoint : tangentStartPoint,
    end: swapped ? tangentStartPoint : endPoint,
  }
}

export function resolveTangentInfoFromClick({
  clickedId,
  sceneGraphDelta,
}: {
  clickedId: number
  sceneGraphDelta: SceneGraphDelta
}): TangentInfo | null {
  const objects = sceneGraphDelta.new_graph.objects
  const clickedObj = objects[clickedId]
  if (!isPointSegment(clickedObj)) {
    return null
  }

  const pointId = clickedObj.id
  const ownerId = clickedObj.kind.segment.owner
  if (ownerId === null) {
    return null
  }

  const owner = objects[ownerId]
  if (!isLineSegment(owner) && !isArcSegment(owner)) {
    return null
  }

  const isStartPoint = owner.kind.segment.start === pointId
  const isEndPoint = owner.kind.segment.end === pointId
  if (!isStartPoint && !isEndPoint) {
    return null
  }

  const pointCoords = getPointFromObjects(objects, pointId)
  const tangentDirection = isLineSegment(owner)
    ? getLineTangentDirection({
        objects,
        segmentId: ownerId,
        tangentPointId: pointId,
      })
    : getArcTangentDirection({
        objects,
        segmentId: ownerId,
        tangentPointId: pointId,
      })
  if (!pointCoords || !tangentDirection) {
    return null
  }

  return {
    segmentId: ownerId,
    tangentStart: {
      id: pointId,
      point: pointCoords,
    },
    tangentDirection,
  }
}

export function addFirstPointListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args) return
      if (args.mouseEvent.which !== 1) return

      const { sceneGraphDelta } = getHoverState(self)
      if (!sceneGraphDelta?.new_graph?.objects) return

      const clickedId = Number(args.selected?.parent?.name)
      if (Number.isNaN(clickedId)) return

      const tangentInfo = resolveTangentInfoFromClick({
        clickedId,
        sceneGraphDelta,
      })
      if (!tangentInfo) return

      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return

      self.send({
        type: 'select tangent info',
        data: tangentInfo,
      })
    },
    onMove: ({ intersectionPoint }: OnMoveCallbackArgs) => {
      const snapshot = self._parent?.getSnapshot()
      if (!snapshot) {
        console.warn("Couldn't get snapshot")
        return
      }
      const mousePosition = [
        intersectionPoint.twoD.x,
        intersectionPoint.twoD.y,
      ] as Coords2d

      const apiObjects =
        snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects ??
        []
      const closestObjects = findClosestApiObjects(
        mousePosition,
        apiObjects,
        context.sceneInfra
      )

      const sceneGraphDelta =
        snapshot?.context?.sketchExecOutcome?.sceneGraphDelta

      const closestObjectForTrangentStart = closestObjects.find(
        (obj) =>
          resolveTangentInfoFromClick({
            clickedId: obj.apiObject.id,
            sceneGraphDelta,
          }) !== null
      )

      self._parent?.send({
        type: 'update hovered id',
        data: {
          hoveredId: closestObjectForTrangentStart?.apiObject.id ?? null,
        },
      })
    },
  })
}

export function animateArcEndPointListener({ self, context }: ToolActionArgs) {
  if (!context.arcId || !context.tangentInfo) {
    return
  }

  self._parent?.send({
    type: 'update hovered id',
    data: {
      hoveredId: null,
    },
  })

  let isEditInProgress = false
  let cachedSettings: Awaited<ReturnType<typeof jsAppSettings>> | null = null

  context.sceneInfra.setCallbacks({
    onMove: async (args) => {
      if (!args || !context.arcId || !context.tangentInfo) {
        return
      }

      const twoD = args.intersectionPoint?.twoD
      if (!twoD || isEditInProgress) return

      const endPoint: Coords2d = [twoD.x, twoD.y]
      const centerPoint = findTangentialArcCenter({
        startPoint: context.tangentInfo.tangentStart.point,
        endPoint,
        tangentDirection: context.tangentInfo.tangentDirection,
      })
      if (!centerPoint) {
        return
      }
      const arcEndpoints = resolveTangentialArcEndpoints(
        context.tangentInfo.tangentStart.point,
        endPoint,
        context.tangentInfo.tangentDirection
      )

      const units = baseUnitToNumericSuffix(
        context.kclManager.fileSettings.defaultLengthUnit
      )

      try {
        isEditInProgress = true
        if (!cachedSettings) {
          cachedSettings = jsAppSettings(context.rustContext.settingsActor)
        }
        const settings = cachedSettings

        const result = await context.rustContext.editSegments(
          0,
          context.sketchId,
          [
            {
              id: context.arcId,
              ctor: {
                type: 'Arc',
                center: {
                  x: { type: 'Var', value: roundOff(centerPoint[0]), units },
                  y: { type: 'Var', value: roundOff(centerPoint[1]), units },
                },
                start: {
                  x: {
                    type: 'Var',
                    value: roundOff(arcEndpoints.start[0]),
                    units,
                  },
                  y: {
                    type: 'Var',
                    value: roundOff(arcEndpoints.start[1]),
                    units,
                  },
                },
                end: {
                  x: {
                    type: 'Var',
                    value: roundOff(arcEndpoints.end[0]),
                    units,
                  },
                  y: {
                    type: 'Var',
                    value: roundOff(arcEndpoints.end[1]),
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
      } catch (err) {
        console.error('failed to edit tangential arc segment', err)
      } finally {
        isEditInProgress = false
      }
    },
    onClick: (args) => {
      if (!args) return
      if (args.mouseEvent.which !== 1) return

      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return

      self.send({
        type: 'add point',
        data: [twoD.x, twoD.y],
        clickNumber: 2,
      })
    },
    onMouseEnter: () => {},
    onMouseLeave: () => {},
  })
}

export function removePointListener({ context }: ToolActionArgs) {
  segmentUtilsMap.ArcSegment.removePreviewCircle(context.sceneInfra)
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
    onMouseEnter: () => {},
    onMouseLeave: () => {},
  })
}

export function sendResultToParent({ event, self }: ToolActionArgs) {
  if (!('output' in event) || !event.output) {
    return
  }

  const output = event.output as {
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
    error?: string
  }

  if (output.error || !output.kclSource || !output.sceneGraphDelta) {
    return
  }

  const sendData: SketchSolveMachineEvent = {
    type: 'update sketch outcome',
    data: {
      sourceDelta: output.kclSource,
      sceneGraphDelta: output.sceneGraphDelta,
    },
  }
  self._parent?.send(sendData)
}

export function storeCreatedArcResult({
  event,
  self,
}: ToolAssignArgs): Partial<ToolContext> {
  if (!('output' in event) || !event.output) {
    return {}
  }

  const output = event.output as {
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
    error?: string
  }
  if (output.error || !output.sceneGraphDelta) {
    return {}
  }

  const arcObjId = output.sceneGraphDelta.new_objects.find((objId: number) => {
    const obj = output.sceneGraphDelta!.new_graph.objects[objId]
    return isArcSegment(obj)
  })

  let arcId: number | undefined
  if (arcObjId !== undefined) {
    arcId = arcObjId
  }

  const entitiesToTrack: {
    segmentIds: Array<number>
    constraintIds: Array<number>
  } = {
    segmentIds: [],
    constraintIds: [],
  }

  if (arcObjId !== undefined) {
    entitiesToTrack.segmentIds.push(arcObjId)

    const pointIds = output.sceneGraphDelta.new_objects.filter(
      (objId: number) => {
        const obj = output.sceneGraphDelta!.new_graph.objects[objId]
        return isPointSegment(obj)
      }
    )
    entitiesToTrack.segmentIds.push(...pointIds)
  }

  if (entitiesToTrack.segmentIds.length > 0) {
    const sendData: SketchSolveMachineEvent = {
      type: 'set draft entities',
      data: entitiesToTrack,
    }
    self._parent?.send(sendData)
  }

  return {
    arcId,
  }
}

export async function createArcActor({
  input,
}: {
  input:
    | {
        tangentInfo: TangentInfo
        rustContext: RustContext
        kclManager: KclManager
        sketchId: number
      }
    | {
        error: string
      }
}): Promise<
  | {
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }
  | {
      error: string
    }
> {
  if ('error' in input) {
    return { error: input.error }
  }

  const { tangentInfo, rustContext, kclManager, sketchId } = input
  const startPoint = tangentInfo.tangentStart.point
  const tangentDirection = tangentInfo.tangentDirection
  const tangentUnit = normalizeVec(tangentDirection)
  if (isInvalidUnitVector(tangentUnit)) {
    return { error: 'Invalid tangent direction' }
  }

  const normal = perpendicular(tangentUnit)
  const centerPoint = addVec(startPoint, normal)
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )

  try {
    const segmentCtor: SegmentCtor = {
      type: 'Arc',
      center: {
        x: { type: 'Var', value: roundOff(centerPoint[0]), units },
        y: { type: 'Var', value: roundOff(centerPoint[1]), units },
      },
      start: {
        x: { type: 'Var', value: roundOff(startPoint[0]), units },
        y: { type: 'Var', value: roundOff(startPoint[1]), units },
      },
      end: {
        x: { type: 'Var', value: roundOff(startPoint[0]), units },
        y: { type: 'Var', value: roundOff(startPoint[1]), units },
      },
    }

    return await rustContext.addSegment(
      0,
      sketchId,
      segmentCtor,
      'arc-segment',
      jsAppSettings(rustContext.settingsActor)
    )
  } catch (error) {
    console.error('Failed to create tangential arc:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function finalizeArcActor({
  input,
}: {
  input:
    | {
        arcId: number
        endPoint: Coords2d
        tangentInfo: TangentInfo
        rustContext: RustContext
        kclManager: KclManager
        sketchId: number
      }
    | {
        error: string
      }
}): Promise<
  | {
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }
  | {
      error: string
    }
> {
  if ('error' in input) {
    return { error: input.error }
  }

  const { arcId, endPoint, tangentInfo, rustContext, kclManager, sketchId } =
    input
  const startPoint = tangentInfo.tangentStart.point
  const tangentDirection = tangentInfo.tangentDirection
  const tangentSegmentId = tangentInfo.segmentId
  const tangentStartId = tangentInfo.tangentStart.id

  const centerPoint = findTangentialArcCenter({
    startPoint,
    endPoint,
    tangentDirection,
  })
  if (!centerPoint) {
    return {
      error: 'Could not solve a tangential arc center for this endpoint',
    }
  }
  const arcEndpoints = resolveTangentialArcEndpoints(
    startPoint,
    endPoint,
    tangentDirection
  )

  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )

  try {
    const settings = jsAppSettings(rustContext.settingsActor)
    const arcEditResult = await rustContext.editSegments(
      0,
      sketchId,
      [
        {
          id: arcId,
          ctor: {
            type: 'Arc',
            center: {
              x: { type: 'Var', value: roundOff(centerPoint[0]), units },
              y: { type: 'Var', value: roundOff(centerPoint[1]), units },
            },
            start: {
              x: {
                type: 'Var',
                value: roundOff(arcEndpoints.start[0]),
                units,
              },
              y: {
                type: 'Var',
                value: roundOff(arcEndpoints.start[1]),
                units,
              },
            },
            end: {
              x: {
                type: 'Var',
                value: roundOff(arcEndpoints.end[0]),
                units,
              },
              y: {
                type: 'Var',
                value: roundOff(arcEndpoints.end[1]),
                units,
              },
            },
          },
        },
      ],
      settings
    )

    const arcObj = arcEditResult.sceneGraphDelta.new_graph.objects[arcId]
    if (!isArcSegment(arcObj)) {
      return { error: 'Failed to find arc after final edit' }
    }

    const tangentArcPointId = arcEndpoints.swapped
      ? arcObj.kind.segment.end
      : arcObj.kind.segment.start

    await rustContext.addConstraint(
      0,
      sketchId,
      {
        type: 'Coincident',
        segments: [tangentStartId, tangentArcPointId],
      },
      settings
    )

    return await rustContext.addConstraint(
      0,
      sketchId,
      {
        type: 'Tangent',
        input: [tangentSegmentId, arcId],
      },
      settings
    )
  } catch (error) {
    console.error('Failed to finalize tangential arc:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
