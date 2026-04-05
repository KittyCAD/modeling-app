import type {
  SceneGraphDelta,
  SourceDelta,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { getAngleDiff, roundOff } from '@src/lib/utils'
import { lerp2d, subVec } from '@src/lib/utils2d'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { ActionArgs, AssignArgs, ProvidedActor } from 'xstate'
import { calculate_circle_from_3_points } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import {
  isArcSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  getCoincidentSegmentsForSnapTarget,
  type SnapTarget,
} from '@src/machines/sketchSolve/snapping'
import {
  clearToolSnappingState,
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'

export const TOOL_ID = 'Three-point arc tool'
export const ADDING_FIRST_POINT = `xstate.done.actor.0.${TOOL_ID}.Adding first point`
export const ADDING_SECOND_POINT = `xstate.done.actor.0.${TOOL_ID}.Adding second point`
export const CREATING_ARC = `xstate.done.actor.0.${TOOL_ID}.Creating arc`
export const FINALIZING_ARC = `xstate.done.actor.0.${TOOL_ID}.Finalizing arc`

const EPSILON = 1e-8

type AddDraftPointOutput = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  pointId: number
  point: Coords2d
}

type CreateArcOutput = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  arcId: number
}

type ErrorOutput = {
  error: string
}

type ToolDoneOutput = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  pointId?: number
  point?: Coords2d
  arcId?: number
}

export type ToolEvents =
  | BaseToolEvent
  | {
      type: 'add point'
      data: Coords2d
      clickNumber?: 1 | 2 | 3
      snapTarget?: SnapTarget
    }
  | {
      type:
        | typeof ADDING_FIRST_POINT
        | typeof ADDING_SECOND_POINT
        | typeof CREATING_ARC
        | typeof FINALIZING_ARC
      output: ToolDoneOutput
    }

export type ToolContext = {
  startPoint?: Coords2d
  startPointId?: number
  throughPoint?: Coords2d
  throughPointId?: number
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

function collectDraftSegmentIds(ids: Array<number | undefined>): Array<number> {
  return [...new Set(ids.filter((id): id is number => id !== undefined))]
}

function sendDraftEntitiesToParent({
  self,
  segmentIds,
}: {
  self: ToolActionArgs['self']
  segmentIds: Array<number>
}) {
  if (segmentIds.length === 0) return
  const sendData: SketchSolveMachineEvent = {
    type: 'set draft entities',
    data: { segmentIds, constraintIds: [] },
  }
  self._parent?.send(sendData)
}

function findThreePointArcCenter({
  startPoint,
  endPoint,
  throughPoint,
}: {
  startPoint: Coords2d
  endPoint: Coords2d
  throughPoint: Coords2d
}): Coords2d | null {
  const { center_x, center_y, radius } = calculate_circle_from_3_points(
    startPoint[0],
    startPoint[1],
    endPoint[0],
    endPoint[1],
    throughPoint[0],
    throughPoint[1]
  )

  if (
    !Number.isFinite(center_x) ||
    !Number.isFinite(center_y) ||
    !Number.isFinite(radius) ||
    radius < EPSILON
  ) {
    return null
  }

  return [center_x, center_y]
}

function resolveArcEndpoints({
  centerPoint,
  startPoint,
  endPoint,
  throughPoint,
}: {
  centerPoint: Coords2d
  startPoint: Coords2d
  endPoint: Coords2d
  throughPoint: Coords2d
}): {
  start: Coords2d
  end: Coords2d
  clickedPointIsStart: boolean
} {
  const startFromCenter = subVec(startPoint, centerPoint)
  const endFromCenter = subVec(endPoint, centerPoint)
  const throughFromCenter = subVec(throughPoint, centerPoint)

  const startAngle = Math.atan2(startFromCenter[1], startFromCenter[0])
  const endAngle = Math.atan2(endFromCenter[1], endFromCenter[0])
  const throughAngle = Math.atan2(throughFromCenter[1], throughFromCenter[0])

  const endSpan = getAngleDiff(startAngle, endAngle, true)
  const throughSpan = getAngleDiff(startAngle, throughAngle, true)
  const throughIsOnArc = throughSpan <= endSpan + EPSILON

  if (throughIsOnArc) {
    return {
      start: startPoint,
      end: endPoint,
      clickedPointIsStart: false,
    }
  }
  return {
    start: endPoint,
    end: startPoint,
    clickedPointIsStart: true,
  }
}

async function editArcWithThreePoints({
  arcId,
  startPoint,
  endPoint,
  throughPoint,
  rustContext,
  kclManager,
  sketchId,
  settings,
}: {
  arcId: number
  startPoint: Coords2d
  endPoint: Coords2d
  throughPoint: Coords2d
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  settings: Awaited<ReturnType<typeof jsAppSettings>>
}): Promise<
  | {
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }
  | ErrorOutput
> {
  const centerPoint = findThreePointArcCenter({
    startPoint,
    endPoint,
    throughPoint,
  })
  if (!centerPoint) {
    return { error: 'Cannot create arc from collinear points' }
  }

  const arcEndpoints = resolveArcEndpoints({
    centerPoint,
    startPoint,
    endPoint,
    throughPoint,
  })

  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )

  return rustContext.editSegments(
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
            x: { type: 'Var', value: roundOff(arcEndpoints.start[0]), units },
            y: { type: 'Var', value: roundOff(arcEndpoints.start[1]), units },
          },
          end: {
            x: { type: 'Var', value: roundOff(arcEndpoints.end[0]), units },
            y: { type: 'Var', value: roundOff(arcEndpoints.end[1]), units },
          },
        },
      },
    ],
    settings
  )
}

export function addFirstPointListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) return
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getBestSnappingCandidate({
        self,
        sceneInfra: context.sceneInfra,
        sketchId: context.sketchId,
        mousePosition,
        mouseEvent: args.mouseEvent,
      })
      const [x, y] = snappingCandidate?.position ?? mousePosition
      self.send({
        type: 'add point',
        data: [x, y],
        clickNumber: 1,
        snapTarget: snappingCandidate?.target,
      })
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
      })
      sendHoveredSnappingCandidate(self, snappingCandidate)
      updateToolSnappingPreview({
        sceneInfra: context.sceneInfra,
        target: snappingCandidate,
      })
    },
  })
}

export function addSecondPointListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) return
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getBestSnappingCandidate({
        self,
        sceneInfra: context.sceneInfra,
        sketchId: context.sketchId,
        mousePosition,
        mouseEvent: args.mouseEvent,
        excludedPointIds:
          context.startPointId === undefined ? [] : [context.startPointId],
      })
      const [x, y] = snappingCandidate?.position ?? mousePosition
      self.send({
        type: 'add point',
        data: [x, y],
        clickNumber: 2,
        snapTarget: snappingCandidate?.target,
      })
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
        excludedPointIds:
          context.startPointId === undefined ? [] : [context.startPointId],
      })
      sendHoveredSnappingCandidate(self, snappingCandidate)
      updateToolSnappingPreview({
        sceneInfra: context.sceneInfra,
        target: snappingCandidate,
      })
    },
  })
}

export function animateArcEndPointListener({ self, context }: ToolActionArgs) {
  const { startPoint, throughPoint, arcId } = context
  if (!startPoint || !throughPoint || !arcId) return

  let isEditInProgress = false
  let cachedSettings: Awaited<ReturnType<typeof jsAppSettings>> | null = null

  context.sceneInfra.setCallbacks({
    onMove: async (args) => {
      if (!args || isEditInProgress) return
      const twoD = args.intersectionPoint?.twoD
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
        excludedPointIds: [
          context.startPointId,
          context.throughPointId,
          context.arcStartPointId,
          context.arcEndPointId,
        ].filter((id): id is number => id !== undefined),
      })
      sendHoveredSnappingCandidate(self, snappingCandidate)
      updateToolSnappingPreview({
        sceneInfra: context.sceneInfra,
        target: snappingCandidate,
      })

      try {
        isEditInProgress = true
        if (!cachedSettings) {
          cachedSettings = jsAppSettings(context.rustContext.settingsActor)
        }

        const result = await editArcWithThreePoints({
          arcId,
          startPoint,
          endPoint: [twoD.x, twoD.y],
          throughPoint,
          rustContext: context.rustContext,
          kclManager: context.kclManager,
          sketchId: context.sketchId,
          settings: cachedSettings,
        })
        if ('error' in result) return

        const sendData: SketchSolveMachineEvent = {
          type: 'update sketch outcome',
          data: {
            sourceDelta: result.kclSource,
            sceneGraphDelta: result.sceneGraphDelta,
            writeToDisk: false,
          },
        }
        self._parent?.send(sendData)
      } catch {
        // Ignore collinear preview positions while moving.
      } finally {
        isEditInProgress = false
      }
    },
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) return
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getBestSnappingCandidate({
        self,
        sceneInfra: context.sceneInfra,
        sketchId: context.sketchId,
        mousePosition,
        mouseEvent: args.mouseEvent,
        excludedPointIds: [
          context.startPointId,
          context.throughPointId,
          context.arcStartPointId,
          context.arcEndPointId,
        ].filter((id): id is number => id !== undefined),
      })
      const [x, y] = snappingCandidate?.position ?? mousePosition
      self.send({
        type: 'add point',
        data: [x, y],
        clickNumber: 3,
        snapTarget: snappingCandidate?.target,
      })
    },
  })
}

export function removePointListener({ context, self }: ToolActionArgs) {
  clearToolSnappingState({
    self,
    sceneInfra: context.sceneInfra,
  })
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export function sendResultToParent({ event, self }: ToolActionArgs) {
  if (!('output' in event) || !event.output) return

  const output = event.output
  if (!output.kclSource || !output.sceneGraphDelta) return

  const sendData: SketchSolveMachineEvent = {
    type: 'update sketch outcome',
    data: {
      sourceDelta: output.kclSource,
      sceneGraphDelta: output.sceneGraphDelta,
    },
  }
  self._parent?.send(sendData)
}

export function storeFirstPointResult({
  event,
  self,
}: ToolAssignArgs<any>): Partial<ToolContext> {
  if (!('output' in event) || !event.output) return {}

  const output = event.output
  if (output.pointId === undefined || !output.point) return {}

  sendDraftEntitiesToParent({
    self,
    segmentIds: collectDraftSegmentIds([output.pointId]),
  })

  return {
    startPoint: output.point,
    startPointId: output.pointId,
  }
}

export function storeSecondPointResult({
  context,
  event,
  self,
}: ToolAssignArgs<any>): Partial<ToolContext> {
  if (!('output' in event) || !event.output) return {}

  const output = event.output
  if (output.pointId === undefined || !output.point) return {}

  sendDraftEntitiesToParent({
    self,
    segmentIds: collectDraftSegmentIds([context.startPointId, output.pointId]),
  })

  return {
    throughPoint: output.point,
    throughPointId: output.pointId,
  }
}

export function storeCreatedArcResult({
  context,
  event,
  self,
}: ToolAssignArgs<any>): Partial<ToolContext> {
  if (!('output' in event) || !event.output) return {}

  const output = event.output
  if (output.arcId === undefined) return {}

  const arcObj = output.sceneGraphDelta?.new_graph.objects[output.arcId]
  const arcStartPointId = isArcSegment(arcObj)
    ? arcObj.kind.segment.start
    : undefined
  const arcEndPointId = isArcSegment(arcObj)
    ? arcObj.kind.segment.end
    : undefined

  sendDraftEntitiesToParent({
    self,
    segmentIds: collectDraftSegmentIds([
      context.startPointId,
      context.throughPointId,
      output.arcId,
    ]),
  })

  return {
    arcId: output.arcId,
    arcStartPointId,
    arcEndPointId,
  }
}

export async function addDraftPointActor({
  input,
}: {
  input:
    | {
        point: Coords2d
        snapTarget?: SnapTarget
        rustContext: RustContext
        kclManager: KclManager
        sketchId: number
      }
    | {
        error: string
      }
}): Promise<AddDraftPointOutput | { error: string }> {
  if ('error' in input) {
    return { error: input.error }
  }

  const { point, snapTarget, rustContext, kclManager, sketchId } = input
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )
  const settings = jsAppSettings(rustContext.settingsActor)

  const result = await rustContext.addSegment(
    0,
    sketchId,
    {
      type: 'Point',
      position: {
        x: { type: 'Var', value: roundOff(point[0]), units },
        y: { type: 'Var', value: roundOff(point[1]), units },
      },
    },
    'three-point-arc-draft-point',
    settings
  )

  const pointId = result.sceneGraphDelta.new_objects.find((objId) => {
    const obj = result.sceneGraphDelta.new_graph.objects[objId]
    return isPointSegment(obj)
  })
  if (pointId === undefined) {
    return { error: 'Failed to create draft point' }
  }

  const coincidentSegments = getCoincidentSegmentsForSnapTarget(
    pointId,
    snapTarget
  )
  if (coincidentSegments === null) {
    return {
      ...result,
      pointId,
      point,
    }
  }

  const snapResult = await rustContext.addConstraint(
    0,
    sketchId,
    {
      type: 'Coincident',
      segments: coincidentSegments,
    },
    settings
  )

  return {
    kclSource: snapResult.kclSource,
    sceneGraphDelta: {
      ...snapResult.sceneGraphDelta,
      new_objects: [
        ...result.sceneGraphDelta.new_objects,
        ...snapResult.sceneGraphDelta.new_objects,
      ],
    },
    pointId,
    point,
  }
}

export async function createArcActor({
  input,
}: {
  input:
    | {
        startPoint: Coords2d
        throughPoint: Coords2d
        rustContext: RustContext
        kclManager: KclManager
        sketchId: number
      }
    | {
        error: string
      }
}): Promise<CreateArcOutput | { error: string }> {
  if ('error' in input) {
    return { error: input.error }
  }

  const { startPoint, throughPoint, rustContext, kclManager, sketchId } = input
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )
  const settings = jsAppSettings(rustContext.settingsActor)

  const midpoint = lerp2d(startPoint, throughPoint, 0.5)
  const segmentCtor: SegmentCtor = {
    type: 'Arc',
    start: {
      x: { type: 'Var', value: roundOff(startPoint[0]), units },
      y: { type: 'Var', value: roundOff(startPoint[1]), units },
    },
    end: {
      x: { type: 'Var', value: roundOff(throughPoint[0]), units },
      y: { type: 'Var', value: roundOff(throughPoint[1]), units },
    },
    center: {
      x: { type: 'Var', value: roundOff(midpoint[0]), units },
      y: { type: 'Var', value: roundOff(midpoint[1]), units },
    },
  }

  const result = await rustContext.addSegment(
    0,
    sketchId,
    segmentCtor,
    'three-point-arc-segment',
    settings
  )

  const arcId = result.sceneGraphDelta.new_objects.find((objId) => {
    const obj = result.sceneGraphDelta.new_graph.objects[objId]
    return isArcSegment(obj)
  })
  if (arcId === undefined) {
    return { error: 'Failed to create draft arc' }
  }

  return {
    ...result,
    arcId,
  }
}

export async function finalizeArcActor({
  input,
}: {
  input:
    | {
        arcId: number
        startPoint: Coords2d
        startPointId?: number
        throughPoint: Coords2d
        throughPointId: number
        endPoint: Coords2d
        endSnapTarget?: SnapTarget
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
  | ErrorOutput
> {
  if ('error' in input) {
    return { error: input.error }
  }

  const {
    arcId,
    startPoint,
    startPointId,
    throughPoint,
    throughPointId,
    endPoint,
    endSnapTarget,
    rustContext,
    kclManager,
    sketchId,
  } = input

  const settings = jsAppSettings(rustContext.settingsActor)
  const editResult = await editArcWithThreePoints({
    arcId,
    startPoint,
    endPoint,
    throughPoint,
    rustContext,
    kclManager,
    sketchId,
    settings,
  })
  if ('error' in editResult) {
    return editResult
  }

  const centerPoint = findThreePointArcCenter({
    startPoint,
    endPoint,
    throughPoint,
  })
  if (!centerPoint) {
    return { error: 'Cannot create arc from collinear points' }
  }
  const arcEndpoints = resolveArcEndpoints({
    centerPoint,
    startPoint,
    endPoint,
    throughPoint,
  })

  const editedArc = editResult.sceneGraphDelta.new_graph.objects[arcId]
  if (!isArcSegment(editedArc)) {
    return { error: 'Failed to find arc after final edit' }
  }

  const clickedArcPointId = arcEndpoints.clickedPointIsStart
    ? editedArc.kind.segment.start
    : editedArc.kind.segment.end

  const newObjects = [...editResult.sceneGraphDelta.new_objects]
  let latestKclSource = editResult.kclSource
  let latestSceneGraphDelta = editResult.sceneGraphDelta

  const endCoincidentSegments = getCoincidentSegmentsForSnapTarget(
    clickedArcPointId,
    endSnapTarget
  )
  if (endCoincidentSegments !== null) {
    const snapResult = await rustContext.addConstraint(
      0,
      sketchId,
      {
        type: 'Coincident',
        segments: endCoincidentSegments,
      },
      settings
    )
    latestKclSource = snapResult.kclSource
    latestSceneGraphDelta = snapResult.sceneGraphDelta
    newObjects.push(...snapResult.sceneGraphDelta.new_objects)
  }

  const constraintResult = await rustContext.addConstraint(
    0,
    sketchId,
    {
      type: 'Coincident',
      segments: [throughPointId, arcId],
    },
    settings
  )
  latestKclSource = constraintResult.kclSource
  latestSceneGraphDelta = constraintResult.sceneGraphDelta
  newObjects.push(...constraintResult.sceneGraphDelta.new_objects)

  if (startPointId === undefined) {
    return {
      kclSource: latestKclSource,
      sceneGraphDelta: {
        ...latestSceneGraphDelta,
        new_objects: newObjects,
      },
    }
  }

  const deleteResult = await rustContext.deleteObjects(
    0,
    sketchId,
    [],
    [startPointId],
    settings
  )

  return {
    kclSource: deleteResult.kclSource,
    sceneGraphDelta: {
      ...deleteResult.sceneGraphDelta,
      new_objects: [...newObjects, ...deleteResult.sceneGraphDelta.new_objects],
    },
  }
}
