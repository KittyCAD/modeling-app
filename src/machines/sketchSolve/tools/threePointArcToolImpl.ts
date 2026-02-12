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
import { roundOff } from '@src/lib/utils'
import { addVec, scaleVec } from '@src/lib/utils2d'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { ActionArgs, AssignArgs, ProvidedActor } from 'xstate'

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

type ToolDoneOutput =
  | AddDraftPointOutput
  | CreateArcOutput
  | {
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }

export type ToolEvents =
  | BaseToolEvent
  | {
      type: 'add point'
      data: Coords2d
      clickNumber?: 1 | 2 | 3
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

function normalizeAngle(angle: number): number {
  const tau = 2 * Math.PI
  return ((angle % tau) + tau) % tau
}

function ccwDistance(from: number, to: number): number {
  const tau = 2 * Math.PI
  return (to - from + tau) % tau
}

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

export function findThreePointArcCenter({
  startPoint,
  endPoint,
  throughPoint,
}: {
  startPoint: Coords2d
  endPoint: Coords2d
  throughPoint: Coords2d
}): Coords2d | null {
  const [ax, ay] = startPoint
  const [bx, by] = endPoint
  const [cx, cy] = throughPoint

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < EPSILON) {
    return null
  }

  const ax2ay2 = ax * ax + ay * ay
  const bx2by2 = bx * bx + by * by
  const cx2cy2 = cx * cx + cy * cy

  const ux = (ax2ay2 * (by - cy) + bx2by2 * (cy - ay) + cx2cy2 * (ay - by)) / d
  const uy = (ax2ay2 * (cx - bx) + bx2by2 * (ax - cx) + cx2cy2 * (bx - ax)) / d

  if (!Number.isFinite(ux) || !Number.isFinite(uy)) {
    return null
  }

  return [ux, uy]
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
} {
  const startAngle = normalizeAngle(
    Math.atan2(startPoint[1] - centerPoint[1], startPoint[0] - centerPoint[0])
  )
  const endAngle = normalizeAngle(
    Math.atan2(endPoint[1] - centerPoint[1], endPoint[0] - centerPoint[0])
  )
  const throughAngle = normalizeAngle(
    Math.atan2(
      throughPoint[1] - centerPoint[1],
      throughPoint[0] - centerPoint[0]
    )
  )

  const endSpan = ccwDistance(startAngle, endAngle)
  const throughSpan = ccwDistance(startAngle, throughAngle)
  const throughIsOnArc = throughSpan <= endSpan + EPSILON

  if (throughIsOnArc) {
    return { start: startPoint, end: endPoint }
  }
  return { start: endPoint, end: startPoint }
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
}) {
  const centerPoint = findThreePointArcCenter({
    startPoint,
    endPoint,
    throughPoint,
  })
  if (!centerPoint) {
    throw new Error('Cannot create arc from collinear points')
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
      self.send({
        type: 'add point',
        data: [twoD.x, twoD.y],
        clickNumber: 1,
      })
    },
    onMove: () => {},
  })
}

export function addSecondPointListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) return
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
  const { startPoint, throughPoint, arcId } = context
  if (!startPoint || !throughPoint || !arcId) return

  let isEditInProgress = false
  let cachedSettings: Awaited<ReturnType<typeof jsAppSettings>> | null = null

  context.sceneInfra.setCallbacks({
    onMove: async (args) => {
      if (!args || isEditInProgress) return
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return

      try {
        isEditInProgress = true
        if (!cachedSettings) {
          cachedSettings = await jsAppSettings(
            context.rustContext.settingsActor
          )
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
      self.send({
        type: 'add point',
        data: [twoD.x, twoD.y],
        clickNumber: 3,
      })
    },
  })
}

export function removePointListener({ context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export function sendResultToParent({ event, self }: ToolActionArgs) {
  if (!('output' in event) || !event.output) return

  const output = event.output as {
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
  }
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

  const output = event.output as Partial<AddDraftPointOutput>
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

  const output = event.output as Partial<AddDraftPointOutput>
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

  const output = event.output as Partial<CreateArcOutput>
  if (output.arcId === undefined) return {}

  sendDraftEntitiesToParent({
    self,
    segmentIds: collectDraftSegmentIds([
      context.startPointId,
      context.throughPointId,
      output.arcId,
    ]),
  })

  return { arcId: output.arcId }
}

export async function addDraftPointActor({
  input,
}: {
  input:
    | {
        point: Coords2d
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

  const { point, rustContext, kclManager, sketchId } = input
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )
  const settings = await jsAppSettings(rustContext.settingsActor)

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
    return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
  })
  if (pointId === undefined) {
    return { error: 'Failed to create draft point' }
  }

  return {
    ...result,
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
  const settings = await jsAppSettings(rustContext.settingsActor)

  const midpoint = scaleVec(addVec(startPoint, throughPoint), 0.5)
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
    return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Arc'
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

  const {
    arcId,
    startPoint,
    startPointId,
    throughPoint,
    throughPointId,
    endPoint,
    rustContext,
    kclManager,
    sketchId,
  } = input

  const settings = await jsAppSettings(rustContext.settingsActor)
  await editArcWithThreePoints({
    arcId,
    startPoint,
    endPoint,
    throughPoint,
    rustContext,
    kclManager,
    sketchId,
    settings,
  })

  const constraintResult = await rustContext.addConstraint(
    0,
    sketchId,
    {
      type: 'Coincident',
      segments: [throughPointId, arcId],
    },
    settings
  )

  if (startPointId === undefined) {
    return constraintResult
  }

  return rustContext.deleteObjects(0, sketchId, [], [startPointId], settings)
}
