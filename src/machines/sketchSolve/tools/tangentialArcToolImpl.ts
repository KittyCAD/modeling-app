import type {
  ApiObject,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
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
  scaleVec,
  subVec,
} from '@src/lib/utils2d'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import { Group, type Object3D } from 'three'
import type { ActionArgs, AssignArgs, ProvidedActor } from 'xstate'

export const TOOL_ID = 'Tangential arc tool'
export const CREATING_ARC = `xstate.done.actor.0.${TOOL_ID}.Creating arc`
export const FINALIZING_ARC = `xstate.done.actor.0.${TOOL_ID}.Finalizing arc`

const EPSILON = 1e-8

export type TangentInfo = {
  lineId: number
  tangentStart: {
    id: number
    point: Coords2d
  }
  tangentDirection: Coords2d
}

export type ToolEvents =
  | BaseToolEvent
  | {
      type: 'select tangent anchor'
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
  arcStartPointId?: number
  arcEndPointId?: number
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

function perpendicular(v: Coords2d): Coords2d {
  return [-v[1], v[0]]
}

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

function getLineTangentDirection({
  objects,
  lineId,
}: {
  objects: Array<ApiObject>
  lineId: number
}): Coords2d | null {
  const lineObj = objects[lineId]
  if (
    !lineObj ||
    lineObj.kind.type !== 'Segment' ||
    lineObj.kind.segment.type !== 'Line'
  ) {
    return null
  }

  const startPoint = getPointFromObjects(objects, lineObj.kind.segment.start)
  const endPoint = getPointFromObjects(objects, lineObj.kind.segment.end)
  if (!startPoint || !endPoint) {
    return null
  }

  const tangentDirection = normalizeVec(subVec(endPoint, startPoint))
  if (isInvalidUnitVector(tangentDirection)) {
    return null
  }

  return tangentDirection
}

function findNumericGroupId(obj: Object3D | undefined): number | null {
  if (!obj) return null

  let current: Object3D | null = obj
  while (current) {
    if (current instanceof Group) {
      const id = Number(current.name)
      if (!Number.isNaN(id)) {
        return id
      }
    }
    current = current.parent
  }
  return null
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

export function resolveTangentAnchorFromClick({
  clickedId,
  clickPoint,
  sceneGraphDelta,
}: {
  clickedId: number
  clickPoint: Coords2d
  sceneGraphDelta: SceneGraphDelta
}): TangentInfo | null {
  const objects = sceneGraphDelta.new_graph.objects
  const clickedObj = objects[clickedId]
  if (!clickedObj || clickedObj.kind.type !== 'Segment') {
    return null
  }

  if (clickedObj.kind.segment.type === 'Line') {
    const line = clickedObj.kind.segment
    const startPoint = getPointFromObjects(objects, line.start)
    const endPoint = getPointFromObjects(objects, line.end)
    const tangentDirection = getLineTangentDirection({
      objects,
      lineId: clickedId,
    })
    if (!startPoint || !endPoint || !tangentDirection) {
      return null
    }

    const startDistance = distance2d(startPoint, clickPoint)
    const endDistance = distance2d(endPoint, clickPoint)

    if (startDistance <= endDistance) {
      return {
        lineId: clickedId,
        tangentStart: {
          id: line.start,
          point: startPoint,
        },
        tangentDirection,
      }
    }

    return {
      lineId: clickedId,
      tangentStart: {
        id: line.end,
        point: endPoint,
      },
      tangentDirection,
    }
  }

  if (clickedObj.kind.segment.type === 'Point') {
    const pointId = clickedObj.id
    const ownerId = clickedObj.kind.segment.owner
    if (ownerId === null) {
      return null
    }

    const owner = objects[ownerId]
    if (
      !owner ||
      owner.kind.type !== 'Segment' ||
      owner.kind.segment.type !== 'Line'
    ) {
      return null
    }

    if (
      owner.kind.segment.start !== pointId &&
      owner.kind.segment.end !== pointId
    ) {
      return null
    }

    const pointCoords = getPointFromObjects(objects, pointId)
    const tangentDirection = getLineTangentDirection({
      objects,
      lineId: ownerId,
    })
    if (!pointCoords || !tangentDirection) {
      return null
    }

    return {
      lineId: ownerId,
      tangentStart: {
        id: pointId,
        point: pointCoords,
      },
      tangentDirection,
    }
  }

  return null
}

export function addTangentAnchorListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args) return
      if (args.mouseEvent.which !== 1) return

      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return

      const sceneGraphDelta =
        self._parent?.getSnapshot()?.context?.sketchExecOutcome?.sceneGraphDelta
      if (!sceneGraphDelta?.new_graph?.objects) return

      const selectedId = findNumericGroupId(args.selected)
      const intersectId = args.intersects
        .map((intersect) => findNumericGroupId(intersect.object))
        .find((id): id is number => id !== null)
      const clickedId = selectedId ?? intersectId
      if (clickedId === undefined) return

      const anchor = resolveTangentAnchorFromClick({
        clickedId,
        clickPoint: [twoD.x, twoD.y],
        sceneGraphDelta,
      })
      if (!anchor) return

      self.send({
        type: 'select tangent anchor',
        data: anchor,
      })
    },
    onMove: () => {},
  })
}

export function addPointListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
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
    onMove: () => {},
  })
}

export function animateArcEndPointListener({ self, context }: ToolActionArgs) {
  if (!context.arcId || !context.tangentInfo) {
    return
  }

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
          cachedSettings = await jsAppSettings(
            context.rustContext.settingsActor
          )
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
  })
}

export function removePointListener({ context }: ToolActionArgs) {
  segmentUtilsMap.ArcSegment.removePreviewCircle(context.sceneInfra)
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export function sendResultToParent({
  event,
  self,
}: ToolAssignArgs<any>) {
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
}: ToolAssignArgs<any>): Partial<ToolContext> {
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
    return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Arc'
  })

  let arcId: number | undefined
  let arcStartPointId: number | undefined
  let arcEndPointId: number | undefined
  if (arcObjId !== undefined) {
    arcId = arcObjId
    const arcObj = output.sceneGraphDelta.new_graph.objects[arcObjId]
    if (arcObj?.kind.type === 'Segment' && arcObj.kind.segment.type === 'Arc') {
      arcStartPointId = arcObj.kind.segment.start
      arcEndPointId = arcObj.kind.segment.end
    }
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
        return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
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
    arcStartPointId,
    arcEndPointId,
  }
}

function getLineFromDelta(
  sceneGraphDelta: SceneGraphDelta
): { lineId: number; startPointId: number; endPointId: number } | Error {
  const lineId = [...sceneGraphDelta.new_objects].reverse().find((objId) => {
    const obj = sceneGraphDelta.new_graph.objects[objId]
    return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Line'
  })

  if (lineId === undefined) {
    return new Error(
      'Expected helper line to be created, but no line was found'
    )
  }

  const lineObj = sceneGraphDelta.new_graph.objects[lineId]
  if (
    lineObj?.kind.type !== 'Segment' ||
    lineObj.kind.segment.type !== 'Line'
  ) {
    return new Error('Expected a line object in scene graph delta')
  }

  return {
    lineId,
    startPointId: lineObj.kind.segment.start,
    endPointId: lineObj.kind.segment.end,
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
      await jsAppSettings(rustContext.settingsActor)
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
  const tangentLineId = tangentInfo.lineId
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
    const settings = await jsAppSettings(rustContext.settingsActor)
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
    if (
      !arcObj ||
      arcObj.kind.type !== 'Segment' ||
      arcObj.kind.segment.type !== 'Arc'
    ) {
      return { error: 'Failed to find arc after final edit' }
    }

    const arcCenterPointId = arcObj.kind.segment.center
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

    // Add a construction line helper to be able to set an orthogonal constraint
    // to enforce tangent direction.
    const helperLineResult = await rustContext.addSegment(
      0,
      sketchId,
      {
        type: 'Line',
        start: {
          x: { type: 'Var', value: roundOff(centerPoint[0]), units },
          y: { type: 'Var', value: roundOff(centerPoint[1]), units },
        },
        end: {
          x: { type: 'Var', value: roundOff(startPoint[0]), units },
          y: { type: 'Var', value: roundOff(startPoint[1]), units },
        },
        construction: true,
      },
      'tangent-helper-line',
      settings
    )

    const helperLine = getLineFromDelta(helperLineResult.sceneGraphDelta)
    if (helperLine instanceof Error) {
      return { error: helperLine.message }
    }

    await rustContext.addConstraint(
      0,
      sketchId,
      {
        type: 'Coincident',
        segments: [helperLine.startPointId, arcCenterPointId],
      },
      settings
    )

    await rustContext.addConstraint(
      0,
      sketchId,
      {
        type: 'Coincident',
        segments: [helperLine.endPointId, tangentArcPointId],
      },
      settings
    )

    return await rustContext.addConstraint(
      0,
      sketchId,
      {
        type: 'Perpendicular',
        lines: [tangentLineId, helperLine.lineId],
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
