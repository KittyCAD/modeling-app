import type {
  ApiConstraint,
  ApiObject,
  ConstraintSegment,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { toastToolbar } from '@src/lib/toolbarToast'
import { roundOff } from '@src/lib/utils'
import {
  distancePointToLine2d,
  dot2d,
  getCcwSweep,
  getLineIntersection,
  length2d,
  linesAreParallel,
  normalizeVec,
  scaleVec,
  subVec,
} from '@src/lib/utils2d'
import {
  getLinePoints,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import {
  type SnappingCandidate,
  getSnappingCandidates,
} from '@src/machines/sketchSolve/snapping'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  ORIGIN_TARGET,
  type SelectionCoordinates,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import { setup } from 'xstate'

type DimensionToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  initialSelectionIds: SketchSolveSelectionId[]
  initialSelectionCoordinates: SelectionCoordinates
  initialObjects: ApiObject[]
  keepSelection: boolean
  runtime: DraftRuntime
}

type DimensionToolInput = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  initialSelectionIds?: SketchSolveSelectionId[]
  initialSelectionCoordinates?: SelectionCoordinates
  initialObjects?: ApiObject[]
  sceneGraphDelta?: SceneGraphDelta
  keepSelection?: boolean
}

type DimensionToolEvent =
  | BaseToolEvent
  | {
      type: 'done'
    }

type ParentSketchSolveSender = {
  _parent?: { send: (event: SketchSolveMachineEvent) => void }
}

type DimensionToolSelf = ParentSketchSolveSender & {
  send: (event: DimensionToolEvent) => void
}

export type LineSelection = {
  type: 'line'
  id: number
  clickPoint: Coords2d
}

export type PointSelection = {
  type: 'point'
  id: SketchSolveSelectionId
  point: Coords2d
}

type DimensionSelection = LineSelection | PointSelection

type DimensionSnapCandidate = Omit<SnappingCandidate, 'target'> & {
  target:
    | { type: 'line' | 'point'; id: number }
    | { type: typeof ORIGIN_TARGET }
}

function isDimensionToolCandidate(
  candidate: SnappingCandidate
): candidate is DimensionSnapCandidate {
  return (
    candidate.target.type === 'line' ||
    candidate.target.type === 'point' ||
    candidate.target.type === ORIGIN_TARGET
  )
}

export type AngleSector = 1 | 2 | 3 | 4

export type DimensionAngleDraftContext = {
  line0Id: number
  line1Id: number
  line0Direction: Coords2d
  line1Direction: Coords2d
  vertex: Coords2d
  baseSelection: DimensionAngleSelection
}

type DimensionAngleDirections = {
  line0Direction: Coords2d
  line1Direction: Coords2d
}

type DimensionAngleSelection = {
  sector: AngleSector
  inverse: boolean
}

export type DimensionDistanceDraftContext =
  | {
      kind: 'pointPoint'
      point0: PointSelection
      point1: PointSelection
    }
  | {
      kind: 'pointLine'
      point: PointSelection
      line: LineSelection
      distance: number
    }
  | {
      kind: 'lineLine'
      line0: LineSelection
      line1: LineSelection
      distance: number
    }

type DimensionDraftContext =
  | { type: 'angle'; angle: DimensionAngleDraftContext }
  | { type: 'distance'; distance: DimensionDistanceDraftContext }

type DraftRuntime = {
  firstSelection: DimensionSelection | null
  draftContext: DimensionDraftContext | null
  draftConstraintId: number | null
  lastDraftKey: string | null
  previewInFlight: boolean
  queuedMousePoint: Coords2d | null
  // Used by async api calls in case tool got deactivated since
  active: boolean
}

type ApiAngleConstraint = Extract<ApiConstraint, { type: 'Angle' }>
type ApiDistanceConstraint = Extract<
  ApiConstraint,
  { type: 'Distance' | 'HorizontalDistance' | 'VerticalDistance' }
>
type ApiDimensionConstraint = ApiAngleConstraint | ApiDistanceConstraint
export type DimensionDistanceType = ApiDistanceConstraint['type']

const ANGLE_SECTORS = [1, 2, 3, 4] as const satisfies ReadonlyArray<AngleSector>
const DIMENSION_PLACEMENT_PROMPT_TOAST_ID = 'dimension-tool-placement-prompt'

function getDefaultLengthUnit(kclManager: KclManager): NumericSuffix {
  return baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit ?? 'mm'
  )
}

function sendParent(
  self: ParentSketchSolveSender,
  event: SketchSolveMachineEvent
) {
  self._parent?.send(event)
}

function createRuntime(): DraftRuntime {
  return {
    firstSelection: null,
    draftContext: null,
    draftConstraintId: null,
    lastDraftKey: null,
    previewInFlight: false,
    queuedMousePoint: null,
    active: true,
  }
}

function deactivateRuntime(runtime: DraftRuntime) {
  runtime.active = false
  runtime.queuedMousePoint = null
}

function isClickedRayDirectionForward(
  linePoints: readonly [Coords2d, Coords2d],
  vertex: Coords2d,
  clickPoint: Coords2d
): boolean {
  const lineDirection = normalizeVec(subVec(linePoints[1], linePoints[0]))
  const clickDirection = subVec(clickPoint, vertex)
  return dot2d(clickDirection, lineDirection) >= 0
}

// Given which side of line0 and line1 the user clicked, which semantic sector is that?
export function getBaseAngleSector(
  line0RayDirectionIsForward: boolean,
  line1RayDirectionIsForward: boolean
): AngleSector {
  if (line0RayDirectionIsForward && line1RayDirectionIsForward) {
    return 1
  }
  if (!line0RayDirectionIsForward && line1RayDirectionIsForward) {
    return 2
  }
  if (!line0RayDirectionIsForward && !line1RayDirectionIsForward) {
    return 3
  }
  return 4
}

// Given a sector number, what are the ordered start/end rays used to measure the angle?
export function getAngleSectorRays(
  angleContext: DimensionAngleDirections,
  sector: AngleSector
): [Coords2d, Coords2d] {
  switch (sector) {
    case 1:
      return [angleContext.line0Direction, angleContext.line1Direction]
    case 2:
      return [
        angleContext.line1Direction,
        scaleVec(angleContext.line0Direction, -1),
      ]
    case 3:
      return [
        scaleVec(angleContext.line0Direction, -1),
        scaleVec(angleContext.line1Direction, -1),
      ]
    case 4:
      return [
        scaleVec(angleContext.line1Direction, -1),
        angleContext.line0Direction,
      ]
  }
}

function getDimensionAngleContext(
  firstSelection: LineSelection,
  secondSelection: LineSelection,
  objects: ApiObject[]
): DimensionAngleDraftContext | null {
  const line0 = objects[firstSelection.id]
  const line1 = objects[secondSelection.id]
  const line0Points = getLinePoints(line0, objects)
  const line1Points = getLinePoints(line1, objects)
  if (!line0Points || !line1Points) {
    return null
  }

  const line0Vector = subVec(line0Points[1], line0Points[0])
  const line1Vector = subVec(line1Points[1], line1Points[0])
  if (length2d(line0Vector) === 0 || length2d(line1Vector) === 0) {
    return null
  }

  const vertex = getLineIntersection(line0Points, line1Points)
  if (!vertex) {
    return null
  }

  const line0RayDirectionIsForward = isClickedRayDirectionForward(
    line0Points,
    vertex,
    firstSelection.clickPoint
  )
  const line1RayDirectionIsForward = isClickedRayDirectionForward(
    line1Points,
    vertex,
    secondSelection.clickPoint
  )

  const angleContextBase = {
    line0Id: firstSelection.id,
    line1Id: secondSelection.id,
    line0Direction: normalizeVec(line0Vector),
    line1Direction: normalizeVec(line1Vector),
    vertex,
  }
  return {
    ...angleContextBase,
    baseSelection: getVisibleAngleSelection(
      angleContextBase,
      getBaseAngleSector(line0RayDirectionIsForward, line1RayDirectionIsForward)
    ),
  }
}

function getFarthestLinePointFromVertex(
  linePoints: readonly [Coords2d, Coords2d],
  vertex: Coords2d
): Coords2d {
  return length2d(subVec(linePoints[1], vertex)) >=
    length2d(subVec(linePoints[0], vertex))
    ? linePoints[1]
    : linePoints[0]
}

function getInitialAngleLineSelections(
  selectionIds: readonly SketchSolveSelectionId[],
  selectionCoordinates: SelectionCoordinates,
  objects: ApiObject[]
): [LineSelection, LineSelection] | null {
  const lineIds = selectionIds.filter(
    (id): id is number => typeof id === 'number'
  )
  if (lineIds.length !== 2) {
    return null
  }

  const line0Points = getLinePoints(objects[lineIds[0]], objects)
  const line1Points = getLinePoints(objects[lineIds[1]], objects)
  if (!line0Points || !line1Points) {
    return null
  }

  const vertex = getLineIntersection(line0Points, line1Points)
  if (!vertex) {
    return null
  }

  return [
    {
      type: 'line',
      id: lineIds[0],
      clickPoint:
        selectionCoordinates[lineIds[0]] ??
        getFarthestLinePointFromVertex(line0Points, vertex),
    },
    {
      type: 'line',
      id: lineIds[1],
      clickPoint:
        selectionCoordinates[lineIds[1]] ??
        getFarthestLinePointFromVertex(line1Points, vertex),
    },
  ]
}

function pointSelectionFromObject(object: ApiObject | undefined) {
  if (!isPointSegment(object)) {
    return null
  }

  return {
    type: 'point' as const,
    id: object.id,
    point: [
      object.kind.segment.position.x.value,
      object.kind.segment.position.y.value,
    ] as Coords2d,
  }
}

function getInitialDistanceSelections(
  selectionIds: readonly SketchSolveSelectionId[],
  selectionCoordinates: SelectionCoordinates,
  objects: ApiObject[]
): [DimensionSelection, DimensionSelection] | null {
  if (selectionIds.length !== 2) {
    return null
  }

  const firstId = selectionIds[0]
  const secondId = selectionIds[1]

  const selectionFromId = (
    id: SketchSolveSelectionId
  ): DimensionSelection | null => {
    if (id === ORIGIN_TARGET) {
      return { type: 'point', id, point: [0, 0] }
    }

    const point = pointSelectionFromObject(objects[id])
    if (point) {
      return point
    }

    const linePoints = getLinePoints(objects[id], objects)
    if (!linePoints) {
      return null
    }

    return {
      type: 'line',
      id,
      clickPoint: selectionCoordinates[id] ?? linePoints[0],
    }
  }

  const first = selectionFromId(firstId)
  const second = selectionFromId(secondId)
  if (!first || !second) {
    return null
  }

  return [first, second]
}

function getVisibleAngleSelection(
  angleContext: DimensionAngleDirections,
  sector: AngleSector
): DimensionAngleSelection {
  const [start, end] = getAngleSectorRays(angleContext, sector)
  return {
    sector,
    inverse: getCcwSweep(start, end) > Math.PI,
  }
}

function getVisibleAngleSectorRays(
  angleContext: DimensionAngleDirections,
  selection: DimensionAngleSelection
): [Coords2d, Coords2d] {
  const [start, end] = getAngleSectorRays(angleContext, selection.sector)
  return selection.inverse ? [end, start] : [start, end]
}

function getHoveredAngleSelection(
  mousePoint: Coords2d,
  angleContext: DimensionAngleDraftContext
): DimensionAngleSelection {
  const mouseDirection = subVec(mousePoint, angleContext.vertex)
  if (length2d(mouseDirection) === 0) {
    return angleContext.baseSelection
  }

  return (
    ANGLE_SECTORS.map((sector) =>
      getVisibleAngleSelection(angleContext, sector)
    ).find((selection) => {
      const [start, end] = getVisibleAngleSectorRays(angleContext, selection)
      const isDirectionInSector =
        getCcwSweep(start, mouseDirection) <= getCcwSweep(start, end) + 1e-9

      return isDirectionInSector
    }) ?? angleContext.baseSelection
  )
}

function invertAngleSelection(
  selection: DimensionAngleSelection
): DimensionAngleSelection {
  return {
    sector: selection.sector,
    inverse: !selection.inverse,
  }
}

export function getDimensionAngleSelection(
  mousePoint: Coords2d,
  angleContext: DimensionAngleDraftContext
): DimensionAngleSelection {
  const hoveredSelection = getHoveredAngleSelection(mousePoint, angleContext)
  const oppositeBaseSector = ((angleContext.baseSelection.sector + 1) % 4) + 1

  if (hoveredSelection.sector === oppositeBaseSector) {
    return invertAngleSelection(angleContext.baseSelection)
  }

  return hoveredSelection
}

function getDimensionAngleDegrees(
  angleContext: DimensionAngleDraftContext,
  selection: DimensionAngleSelection
) {
  let [start, end] = getAngleSectorRays(angleContext, selection.sector)
  if (selection.inverse) {
    ;[start, end] = [end, start]
  }

  return roundOff((getCcwSweep(start, end) * 180) / Math.PI)
}

function toNumber(value: number, units: NumericSuffix) {
  return {
    value: roundOff(value),
    units,
  }
}

function toConstraintSegment(id: SketchSolveSelectionId): ConstraintSegment {
  return id === ORIGIN_TARGET ? 'ORIGIN' : id
}

export function buildDimensionAngleConstraint(
  angleContext: DimensionAngleDraftContext,
  mousePoint: Coords2d,
  units: NumericSuffix
): ApiAngleConstraint {
  const selection = getDimensionAngleSelection(mousePoint, angleContext)
  const angle = getDimensionAngleDegrees(angleContext, selection)

  return {
    type: 'Angle',
    lines: [angleContext.line0Id, angleContext.line1Id],
    angle: { value: angle, units: 'Deg' },
    sector: selection.sector,
    inverse: selection.inverse,
    labelPosition: {
      x: toNumber(mousePoint[0], units),
      y: toNumber(mousePoint[1], units),
    },
    source: {
      expr: `${angle}deg`,
      is_literal: true,
    },
  }
}

function isBetween(value: number, first: number, second: number) {
  return value >= Math.min(first, second) && value <= Math.max(first, second)
}

export function getDimensionDistanceType(
  mousePoint: Coords2d,
  distanceContext: DimensionDistanceDraftContext
): DimensionDistanceType {
  // HorizontalDistance and VerticalDistance apply only to point pairs.
  // Use Distance for point-line and line-line dimensions.
  if (
    distanceContext.kind === 'pointLine' ||
    distanceContext.kind === 'lineLine'
  ) {
    return 'Distance'
  }

  const point0 = distanceContext.point0.point
  const point1 = distanceContext.point1.point
  const betweenPointsX = isBetween(mousePoint[0], point0[0], point1[0])
  const betweenPointsY = isBetween(mousePoint[1], point0[1], point1[1])

  // Above or below both points, the label selects their horizontal separation.
  if (betweenPointsX && !betweenPointsY) {
    return 'HorizontalDistance'
  }
  // Left or right of both points, the label selects their vertical separation.
  if (betweenPointsY && !betweenPointsX) {
    return 'VerticalDistance'
  }
  // Inside their bounding box or in a diagonal corner, use absolute distance.
  return 'Distance'
}

export function buildDimensionDistanceConstraint(
  distanceContext: DimensionDistanceDraftContext,
  mousePoint: Coords2d,
  units: NumericSuffix
): ApiDistanceConstraint {
  const type = getDimensionDistanceType(mousePoint, distanceContext)
  let distance: number
  let constraintSegments: [ConstraintSegment, ConstraintSegment]
  if (distanceContext.kind === 'pointLine') {
    distance = roundOff(distanceContext.distance)
    constraintSegments = [
      toConstraintSegment(distanceContext.point.id),
      distanceContext.line.id,
    ]
  } else if (distanceContext.kind === 'lineLine') {
    distance = roundOff(distanceContext.distance)
    constraintSegments = [distanceContext.line0.id, distanceContext.line1.id]
  } else {
    const delta = subVec(
      distanceContext.point1.point,
      distanceContext.point0.point
    )
    distance = roundOff(
      type === 'HorizontalDistance'
        ? delta[0]
        : type === 'VerticalDistance'
          ? delta[1]
          : length2d(delta)
    )
    constraintSegments = [
      toConstraintSegment(distanceContext.point0.id),
      toConstraintSegment(distanceContext.point1.id),
    ]
  }

  return {
    type,
    segments: constraintSegments,
    distance: { value: distance, units },
    labelPosition: {
      x: toNumber(mousePoint[0], units),
      y: toNumber(mousePoint[1], units),
    },
    source: {
      expr: distance.toString(),
      is_literal: true,
    },
  }
}

function buildDimensionConstraint(
  draftContext: DimensionDraftContext,
  mousePoint: Coords2d,
  units: NumericSuffix
): ApiDimensionConstraint {
  return draftContext.type === 'angle'
    ? buildDimensionAngleConstraint(draftContext.angle, mousePoint, units)
    : buildDimensionDistanceConstraint(draftContext.distance, mousePoint, units)
}

function getConstraintIdFromResult(
  result: { sceneGraphDelta: SceneGraphDelta },
  constraintType: ApiDimensionConstraint['type']
): number | null {
  return (
    [...result.sceneGraphDelta.new_objects].reverse().find((objectId) => {
      const object = result.sceneGraphDelta.new_graph.objects[objectId]
      return (
        object?.kind.type === 'Constraint' &&
        object.kind.constraint.type === constraintType
      )
    }) ?? null
  )
}

function getDraftKey(constraint: ApiDimensionConstraint) {
  if (constraint.type === 'Angle') {
    return [
      constraint.type,
      constraint.lines.join(','),
      constraint.angle.value,
      constraint.sector ?? '',
      constraint.inverse === true ? 'inverse' : 'direct',
      constraint.labelPosition?.x.value ?? '',
      constraint.labelPosition?.y.value ?? '',
    ].join(':')
  }

  return [
    constraint.type,
    constraint.segments.join(','),
    constraint.distance.value,
    constraint.labelPosition?.x.value ?? '',
    constraint.labelPosition?.y.value ?? '',
  ].join(':')
}

async function deleteInactivePreviewConstraint(
  context: DimensionToolContext,
  constraintId: number
) {
  await context.rustContext.deleteObjects(
    SKETCH_FILE_VERSION,
    context.sketchId,
    [constraintId],
    [],
    jsAppSettings(context.rustContext.settingsActor),
    false
  )
}

function sendPreviewResultToParent(
  self: ParentSketchSolveSender,
  result: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    checkpointId?: number | null
  }
) {
  sendParent(self, {
    type: 'update sketch outcome',
    data: {
      sourceDelta: result.kclSource,
      sceneGraphDelta: result.sceneGraphDelta,
      checkpointId: result.checkpointId ?? null,
      writeToDisk: false,
      addToHistory: false,
      suppressExecOutcomeIssues: true,
    },
  })
}

async function editDimensionConstraint(
  context: DimensionToolContext,
  constraintId: number,
  constraint: ApiDimensionConstraint,
  createCheckpoint: boolean,
  commitSolverResults: boolean
) {
  const settings = jsAppSettings(context.rustContext.settingsActor)
  if (constraint.type === 'Angle') {
    return context.rustContext.editAngleConstraint(
      SKETCH_FILE_VERSION,
      context.sketchId,
      constraintId,
      constraint,
      settings,
      createCheckpoint,
      commitSolverResults
    )
  }

  return context.rustContext.editDistanceConstraint(
    SKETCH_FILE_VERSION,
    context.sketchId,
    constraintId,
    constraint,
    settings,
    createCheckpoint,
    commitSolverResults
  )
}

async function updateDraftConstraint(
  runtime: DraftRuntime,
  context: DimensionToolContext,
  self: ParentSketchSolveSender,
  mousePoint: Coords2d
) {
  if (!runtime.active || !runtime.draftContext) {
    return
  }

  const constraint = buildDimensionConstraint(
    runtime.draftContext,
    mousePoint,
    getDefaultLengthUnit(context.kclManager)
  )
  const draftKey = getDraftKey(constraint)
  // Skip constraint edits when the mouse moved too little to change the draft.
  if (draftKey === runtime.lastDraftKey) {
    return
  }

  const settings = jsAppSettings(context.rustContext.settingsActor)
  const existingConstraintId = runtime.draftConstraintId
  const result =
    existingConstraintId === null
      ? await context.rustContext.addConstraint(
          SKETCH_FILE_VERSION,
          context.sketchId,
          constraint,
          settings,
          false
        )
      : await editDimensionConstraint(
          context,
          existingConstraintId,
          constraint,
          false,
          false
        )

  const constraintId =
    existingConstraintId ?? getConstraintIdFromResult(result, constraint.type)
  if (constraintId === null) {
    return
  }
  if (!runtime.active) {
    if (existingConstraintId === null) {
      await deleteInactivePreviewConstraint(context, constraintId)
    }
    return
  }

  runtime.draftConstraintId = constraintId
  runtime.lastDraftKey = draftKey

  sendPreviewResultToParent(self, result)
  if (existingConstraintId === null) {
    sendParent(self, {
      type: 'set draft entities',
      data: {
        segmentIds: [],
        constraintIds: [constraintId],
      },
    })
  }
}

function requestDraftPreview(
  runtime: DraftRuntime,
  context: DimensionToolContext,
  self: ParentSketchSolveSender,
  mousePoint: Coords2d
) {
  if (!runtime.active) {
    return
  }

  runtime.queuedMousePoint = mousePoint
  if (runtime.previewInFlight) {
    return
  }

  runtime.previewInFlight = true
  void (async () => {
    try {
      while (runtime.active && runtime.queuedMousePoint) {
        const nextMousePoint = runtime.queuedMousePoint
        runtime.queuedMousePoint = null
        await updateDraftConstraint(runtime, context, self, nextMousePoint)
      }
    } catch (error) {
      toastSketchSolveError(error)
    } finally {
      runtime.previewInFlight = false
    }
  })()
}

async function commitDraftConstraint(
  runtime: DraftRuntime,
  context: DimensionToolContext,
  self: DimensionToolSelf,
  mousePoint: Coords2d
) {
  if (!runtime.active || !runtime.draftContext) {
    return
  }

  const constraint = buildDimensionConstraint(
    runtime.draftContext,
    mousePoint,
    getDefaultLengthUnit(context.kclManager)
  )

  try {
    deactivateRuntime(runtime)
    const settings = jsAppSettings(context.rustContext.settingsActor)
    // This is normally never null, except for edge cases:
    // - click is faster than draft preview creation
    // - draft preview creation failed
    const existingConstraintId = runtime.draftConstraintId
    const result =
      existingConstraintId === null
        ? await context.rustContext.addConstraint(
            SKETCH_FILE_VERSION,
            context.sketchId,
            constraint,
            settings,
            true
          )
        : await editDimensionConstraint(
            context,
            existingConstraintId,
            constraint,
            true,
            true
          )

    const constraintId =
      existingConstraintId ?? getConstraintIdFromResult(result, constraint.type)
    runtime.draftConstraintId = null
    sendParent(self, {
      type: 'update sketch outcome',
      data: {
        sourceDelta: result.kclSource,
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId: result.checkpointId ?? null,
      },
    })
    sendParent(self, { type: 'clear draft entities' })
    sendParent(self, {
      type: 'update selected ids',
      data: context.keepSelection
        ? { duringAreaSelectIds: [] }
        : { selectedIds: [], duringAreaSelectIds: [] },
    })
    sendParent(self, {
      type: 'update hovered id',
      data: { hoveredId: constraintId },
    })
    toastToolbar.dismiss(DIMENSION_PLACEMENT_PROMPT_TOAST_ID)
    self.send({ type: 'done' })
  } catch (error) {
    runtime.active = true
    toastSketchSolveError(error)
  }
}

function getClosestDimensionSelection(
  mousePoint: Coords2d,
  context: DimensionToolContext
): DimensionSelection | null {
  const currentSketchObjects = getCurrentSketchObjectsById(
    context.initialObjects,
    context.sketchId
  )
  const closestCandidate = getSnappingCandidates(
    mousePoint,
    currentSketchObjects,
    context.sceneInfra
  ).find(isDimensionToolCandidate)

  if (!closestCandidate) {
    return null
  }

  if (closestCandidate.target.type === ORIGIN_TARGET) {
    return { type: 'point', id: ORIGIN_TARGET, point: [0, 0] }
  }

  const closestObject = currentSketchObjects[closestCandidate.target.id]
  const pointSelection = pointSelectionFromObject(closestObject)
  if (pointSelection) {
    return pointSelection
  }

  return {
    type: 'line',
    id: closestObject.id,
    clickPoint: mousePoint,
  }
}

function getSelectionPoint(selection: DimensionSelection) {
  return selection.type === 'line' ? selection.clickPoint : selection.point
}

function getDimensionDraftContext(
  firstSelection: DimensionSelection,
  secondSelection: DimensionSelection,
  objects: ApiObject[]
): DimensionDraftContext | null {
  if (firstSelection.type === 'line' && secondSelection.type === 'line') {
    const line0 = getLinePoints(objects[firstSelection.id], objects)
    const line1 = getLinePoints(objects[secondSelection.id], objects)
    if (!line0 || !line1) {
      return null
    }

    if (linesAreParallel(line0, line1)) {
      const distance = distancePointToLine2d(line0[0], line1)
      return distance === null
        ? null
        : {
            type: 'distance',
            distance: {
              kind: 'lineLine',
              line0: firstSelection,
              line1: secondSelection,
              distance,
            },
          }
    }

    const angle = getDimensionAngleContext(
      firstSelection,
      secondSelection,
      objects
    )
    return angle ? { type: 'angle', angle } : null
  }

  if (firstSelection.type === 'point' && secondSelection.type === 'point') {
    return {
      type: 'distance',
      distance: {
        kind: 'pointPoint',
        point0: firstSelection,
        point1: secondSelection,
      },
    }
  }

  let point: PointSelection
  let line: LineSelection
  if (firstSelection.type === 'point' && secondSelection.type === 'line') {
    point = firstSelection
    line = secondSelection
  } else if (
    firstSelection.type === 'line' &&
    secondSelection.type === 'point'
  ) {
    point = secondSelection
    line = firstSelection
  } else {
    return null
  }

  const linePoints = getLinePoints(objects[line.id], objects)
  const distance = linePoints
    ? distancePointToLine2d(point.point, linePoints)
    : null
  if (distance === null) {
    return null
  }

  return {
    type: 'distance',
    distance: { kind: 'pointLine', point, line, distance },
  }
}

function updateSelectedEntities(
  self: ParentSketchSolveSender,
  selections: readonly DimensionSelection[]
) {
  const selectionCoordinates: SelectionCoordinates = {}
  for (const selection of selections) {
    if (typeof selection.id === 'number') {
      selectionCoordinates[selection.id] = getSelectionPoint(selection)
    }
  }

  sendParent(self, {
    type: 'update selected ids',
    data: {
      selectedIds: selections.map(({ id }) => id),
      replaceExistingSelection: true,
      selectionCoordinates,
    },
  })
}

function addDimensionListener({
  context,
  self,
}: {
  context: DimensionToolContext
  self: DimensionToolSelf
}) {
  const runtime = context.runtime
  runtime.active = true
  const initialObjects = context.initialObjects
  const initialSelections =
    getInitialAngleLineSelections(
      context.initialSelectionIds,
      context.initialSelectionCoordinates,
      initialObjects
    ) ??
    getInitialDistanceSelections(
      context.initialSelectionIds,
      context.initialSelectionCoordinates,
      initialObjects
    )
  if (initialSelections) {
    const [firstSelection, secondSelection] = initialSelections
    const draftContext = getDimensionDraftContext(
      firstSelection,
      secondSelection,
      initialObjects
    )
    if (draftContext) {
      runtime.firstSelection = firstSelection
      runtime.draftContext = draftContext
      toastToolbar(
        draftContext.type === 'angle'
          ? 'Move mouse to choose sector, then click to place label.'
          : draftContext.distance.kind === 'pointPoint'
            ? 'Move mouse to choose distance type, then click to place label.'
            : 'Move mouse, then click to place label.',
        {
          id: DIMENSION_PLACEMENT_PROMPT_TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
        }
      )
      sendParent(self, {
        type: 'update hovered id',
        data: { hoveredId: null },
      })
      updateSelectedEntities(self, initialSelections)
    }
  }

  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) {
        return
      }

      const twoD = args.intersectionPoint?.twoD
      if (!twoD) {
        return
      }

      const mousePoint: Coords2d = [twoD.x, twoD.y]
      if (!runtime.firstSelection) {
        // First click: choose either a line or a point.
        const selection = getClosestDimensionSelection(mousePoint, context)
        if (selection) {
          runtime.firstSelection = selection
          updateSelectedEntities(self, [selection])
        }
      } else if (!runtime.draftContext) {
        // Second click: complete a line/line, point/point, or point/line pair.
        const selection = getClosestDimensionSelection(mousePoint, context)
        if (selection && selection.id !== runtime.firstSelection.id) {
          const draftContext = getDimensionDraftContext(
            runtime.firstSelection,
            selection,
            initialObjects
          )

          if (draftContext) {
            runtime.draftContext = draftContext
            sendParent(self, {
              type: 'update hovered id',
              data: { hoveredId: null },
            })
            updateSelectedEntities(self, [runtime.firstSelection, selection])
            requestDraftPreview(runtime, context, self, mousePoint)
          }
        }
      } else {
        // Third click: commit the chosen dimension type and label position.
        // If 2 compatible entities were preselected, this is the first click.
        void commitDraftConstraint(runtime, context, self, mousePoint)
      }
    },
    onMove: (args) => {
      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) {
        sendParent(self, {
          type: 'update hovered id',
          data: { hoveredId: null },
        })
        return
      }

      const mousePoint: Coords2d = [twoD.x, twoD.y]
      if (runtime.draftContext) {
        // After the pair is selected, mouse movement updates the dimension draft.
        requestDraftPreview(runtime, context, self, mousePoint)
      } else {
        const selection = getClosestDimensionSelection(mousePoint, context)
        sendParent(self, {
          type: 'update hovered id',
          data: { hoveredId: selection?.id ?? null },
        })
      }
    },
  })
}

function removeDimensionListener({
  context,
}: {
  context: DimensionToolContext
}) {
  deactivateRuntime(context.runtime)
  toastToolbar.dismiss(DIMENSION_PLACEMENT_PROMPT_TOAST_ID)
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export const machine = setup({
  types: {
    context: {} as DimensionToolContext,
    events: {} as DimensionToolEvent,
    input: {} as DimensionToolInput,
  },
  actions: {
    'add dimension listener': addDimensionListener,
    'remove dimension listener': removeDimensionListener,
    'delete draft entities': ({ self }) =>
      sendParent(self, { type: 'delete draft entities' }),
    'toast sketch solve error': ({ event }) => {
      toastSketchSolveError(event)
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QBECWBbMA7WqD2WABAC554A2AxAK5ZgCO1qADgNoAMAuoqM3rsXxYeIAB6J2AGhABPCQF950tJhxCSZcgDoAhgHcdqQViiEAZqgBOsYoT6osxSjogQ7eB8Q7ckIPgKERcQQANgAWMK0AZgB2AFYYgE4ADhD2AEYQqIzpOQQo9PStGOT00rCQxMqAJijkuMVlDGxcAg0KXQMjQlgwAGMCN3tHZ1d3T28RfyNA32DwyNiElLTM7PTcxDC45K1qkLKQ5OqYqLj09iiwxpAVFvVSDoBhAgtLdAdTCGa1AlhKCAEMBaBwANzwAGtgXdfkRHtoXlg3h8TIRvqpWjgEGC8H0dIICN5Jr5pgThHNEHF2DE9ok4md9tUIuFkmFNghkjFqtFUiztmV9jcYZj2gjXlYUV8fpj-mBLJY8JYtMxyPizIr0FphQ9NFpEcjPmjpUJYNisOC8WSiVwpvwZgQglt2OwtCF6TFnYkomd0tU4uzStyyhF0lFEtVEuxqqzFEoQFg8BA4CJtW14baAg6KQgALRhZLsnOhorpL0xLKJeLh-NC41p3X6QzGUxvGzjRwZ+3k0DBKIHLThj0FCJxMIxMKxdm1bkxX1pEpxJnjhpx1NwhtdWy9AZYIYeDsku1kx35EI0kfsKkT9Ie8MhdkRGnHN3bdiRirR66ruvr57i96Gui9x-J2x7Zt6NJemEzp+icfr3rIiAHJEYTVDeo6ltUfqJIktYYjqHS0AwTDMMwnygbMPYSAGZwDr6VLjuElaLrG8hAA */
  context: ({ input }): DimensionToolContext => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId,
    initialSelectionIds: input.initialSelectionIds ?? [],
    initialSelectionCoordinates: input.initialSelectionCoordinates ?? {},
    initialObjects:
      input.initialObjects ?? input.sceneGraphDelta?.new_graph.objects ?? [],
    keepSelection: input.keepSelection ?? false,
    runtime: createRuntime(),
  }),
  id: 'Dimension tool',
  initial: 'selecting entities',
  on: {
    unequip: {
      target: '#Dimension tool.unequipping',
      actions: 'delete draft entities',
    },
    escape: {
      target: '#Dimension tool.unequipping',
      actions: 'delete draft entities',
    },
  },
  description: 'Creates dimension constraints from sketch selections.',
  states: {
    'selecting entities': {
      entry: 'add dimension listener',
      on: {
        done: {
          target: 'unequipping',
        },
      },
      exit: 'remove dimension listener',
    },
    unequipping: {
      type: 'final',
      description: 'Any teardown logic should go here.',
    },
  },
})
