import type {
  ApiConstraint,
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
import { getAngleDiff, roundOff } from '@src/lib/utils'
import {
  addVec,
  cross2d,
  distance2d,
  dot2d,
  length2d,
  normalizeVec,
  perpendicular,
  scaleVec,
  subVec,
} from '@src/lib/utils2d'
import {
  getArcPoints,
  getCoincidentCluster,
  getCoincidentSegmentIds,
  getLinePoints,
  isArcSegment,
  isCircleSegment,
  isConstraint,
  isDistanceConstraint,
  isLineSegment,
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import {
  clearToolSnappingState,
  sendHoveredSnappingCandidate,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import type { ActionArgs, AssignArgs, ProvidedActor } from 'xstate'

export const TOOL_ID = 'Fillet tool'
export const CREATING_FILLET_ARC = `xstate.done.actor.0.${TOOL_ID}.Creating fillet arc`
export const FINALIZING_FILLET = `xstate.done.actor.0.${TOOL_ID}.Finalizing fillet`

const EPSILON = 1e-7
const MIN_FILLET_RADIUS = 1e-4
const DEFAULT_FILLET_RADIUS = 5
const FILLET_RADIUS_SEARCH_STEPS = 24

type SegmentEndpointName = 'start' | 'end'
type FilletSegmentKind = 'line' | 'arc'
type NumericSuffix = ReturnType<typeof baseUnitToNumericSuffix>
type AppSettings = Awaited<ReturnType<typeof jsAppSettings>>
type DistanceApiConstraint = Extract<
  ApiConstraint,
  { type: 'Distance' | 'HorizontalDistance' | 'VerticalDistance' }
>

export type FilletSegmentInfo = {
  segmentId: number
  endpointId: number
  endpointName: SegmentEndpointName
  kind: FilletSegmentKind
  vertex: Coords2d
  otherPoint: Coords2d
  tangentAway: Coords2d
  length: number
  construction: boolean
  arc?: {
    center: Coords2d
    radius: number
    start: Coords2d
    end: Coords2d
    sharedAt: SegmentEndpointName
  }
}

export type FilletSelection = {
  segmentIds: [number, number]
  sides: [FilletSegmentInfo, FilletSegmentInfo]
  vertex: Coords2d
  adjacencyConstraintIds: number[]
  dimensionConstraints: Array<{
    constraintId: number
    constraint: DistanceApiConstraint
    replacePointIds: number[]
  }>
}

export type FilletGeometry = {
  radius: number
  center: Coords2d
  sideTangencies: [Coords2d, Coords2d]
  arcStart: Coords2d
  arcEnd: Coords2d
  arcStartSideIndex: 0 | 1
}

type FilletArcDraft = {
  arcId: number
  arcStartPointId: number
  arcEndPointId: number
  arcCenterPointId: number
  segmentIds: number[]
}

type ErrorOutput = {
  error: string
}

export type ToolEvents =
  | BaseToolEvent
  | {
      type: 'select first segment'
      data: number
    }
  | {
      type: 'select fillet pair'
      data: FilletSelection
    }
  | {
      type: 'confirm fillet radius'
      data: FilletGeometry
    }
  | {
      type: typeof CREATING_FILLET_ARC | typeof FINALIZING_FILLET
      output:
        | {
            kclSource: SourceDelta
            sceneGraphDelta: SceneGraphDelta
            checkpointId?: number | null
            draft?: FilletArcDraft
          }
        | ErrorOutput
    }

export type ToolContext = {
  firstSegmentId?: number
  selection?: FilletSelection
  currentGeometry?: FilletGeometry
  draft?: FilletArcDraft
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  initialSelectionIds?: SketchSolveSelectionId[]
  initialObjects?: ApiObject[]
}

export type ToolActionArgs = ActionArgs<ToolContext, ToolEvents, ToolEvents>

// biome-ignore lint/suspicious/noExplicitAny: Matches XState helper typing used by the other sketch tool implementations.
type ToolAssignArgs<TActor extends ProvidedActor = any> = AssignArgs<
  ToolContext,
  ToolEvents,
  ToolEvents,
  TActor
>

type OffsetCurve =
  | {
      type: 'line'
      point: Coords2d
      direction: Coords2d
    }
  | {
      type: 'circle'
      center: Coords2d
      radius: number
    }

function makeVarExpr(value: number, units: NumericSuffix) {
  return {
    type: 'Var' as const,
    value: roundOff(value),
    units,
  }
}

function lineCtor({
  start,
  end,
  units,
  construction,
}: {
  start: Coords2d
  end: Coords2d
  units: NumericSuffix
  construction?: boolean
}): SegmentCtor {
  return {
    type: 'Line',
    start: {
      x: makeVarExpr(start[0], units),
      y: makeVarExpr(start[1], units),
    },
    end: {
      x: makeVarExpr(end[0], units),
      y: makeVarExpr(end[1], units),
    },
    ...(construction ? { construction: true } : {}),
  }
}

function arcCtor({
  start,
  end,
  center,
  units,
  construction,
}: {
  start: Coords2d
  end: Coords2d
  center: Coords2d
  units: NumericSuffix
  construction?: boolean
}): SegmentCtor {
  return {
    type: 'Arc',
    start: {
      x: makeVarExpr(start[0], units),
      y: makeVarExpr(start[1], units),
    },
    end: {
      x: makeVarExpr(end[0], units),
      y: makeVarExpr(end[1], units),
    },
    center: {
      x: makeVarExpr(center[0], units),
      y: makeVarExpr(center[1], units),
    },
    ...(construction ? { construction: true } : {}),
  }
}

function pointCtor({
  position,
  units,
}: {
  position: Coords2d
  units: NumericSuffix
}): SegmentCtor {
  return {
    type: 'Point',
    position: {
      x: makeVarExpr(position[0], units),
      y: makeVarExpr(position[1], units),
    },
  }
}

function isValidUnitVector(vector: Coords2d) {
  return (
    Number.isFinite(vector[0]) &&
    Number.isFinite(vector[1]) &&
    length2d(vector) > EPSILON
  )
}

function coordsAlmostEqual(a: Coords2d, b: Coords2d) {
  return distance2d(a, b) <= EPSILON
}

function getPoint(objects: ApiObject[], pointId: number): Coords2d | null {
  const point = objects[pointId]
  return isPointSegment(point) ? pointToCoords2d(point) : null
}

function getSegmentEndpointIds(segment: ApiObject): [number, number] | null {
  if (isLineSegment(segment) || isArcSegment(segment)) {
    return [segment.kind.segment.start, segment.kind.segment.end]
  }

  return null
}

function endpointNameForId(segment: ApiObject, pointId: number) {
  if (!isLineSegment(segment) && !isArcSegment(segment)) {
    return null
  }

  if (segment.kind.segment.start === pointId) {
    return 'start' as const
  }

  if (segment.kind.segment.end === pointId) {
    return 'end' as const
  }

  return null
}

function pointIdCluster(pointId: number, objects: ApiObject[]) {
  return new Set(getCoincidentCluster(pointId, objects))
}

function getSharedEndpointInfo({
  first,
  second,
  objects,
}: {
  first: ApiObject
  second: ApiObject
  objects: ApiObject[]
}): {
  firstEndpointId: number
  secondEndpointId: number
  vertex: Coords2d
  adjacencyConstraintIds: number[]
} | null {
  const firstEndpoints = getSegmentEndpointIds(first)
  const secondEndpoints = getSegmentEndpointIds(second)
  if (!firstEndpoints || !secondEndpoints) {
    return null
  }

  for (const firstEndpointId of firstEndpoints) {
    const firstCluster = pointIdCluster(firstEndpointId, objects)
    for (const secondEndpointId of secondEndpoints) {
      if (!firstCluster.has(secondEndpointId)) {
        continue
      }

      const firstPoint = getPoint(objects, firstEndpointId)
      const secondPoint = getPoint(objects, secondEndpointId)
      if (!firstPoint || !secondPoint) {
        return null
      }

      const vertex: Coords2d = [
        (firstPoint[0] + secondPoint[0]) / 2,
        (firstPoint[1] + secondPoint[1]) / 2,
      ]

      const adjacencyConstraintIds = objects
        .filter(
          (obj) =>
            isConstraint(obj, 'Coincident') &&
            getCoincidentSegmentIds(obj.kind.constraint).includes(
              firstEndpointId
            ) &&
            getCoincidentSegmentIds(obj.kind.constraint).includes(
              secondEndpointId
            )
        )
        .map((obj) => obj.id)

      return {
        firstEndpointId,
        secondEndpointId,
        vertex,
        adjacencyConstraintIds,
      }
    }
  }

  return null
}

function buildLineInfo({
  segment,
  endpointId,
  vertex,
  objects,
}: {
  segment: ApiObject
  endpointId: number
  vertex: Coords2d
  objects: ApiObject[]
}): FilletSegmentInfo | null {
  if (!isLineSegment(segment)) {
    return null
  }

  const linePoints = getLinePoints(segment, objects)
  const endpointName = endpointNameForId(segment, endpointId)
  if (!linePoints || !endpointName) {
    return null
  }

  const otherPoint = endpointName === 'start' ? linePoints[1] : linePoints[0]
  const tangentAway = normalizeVec(subVec(otherPoint, vertex))
  const length = distance2d(vertex, otherPoint)
  if (!isValidUnitVector(tangentAway) || length <= EPSILON) {
    return null
  }

  return {
    segmentId: segment.id,
    endpointId,
    endpointName,
    kind: 'line',
    vertex,
    otherPoint,
    tangentAway,
    length,
    construction: segment.kind.segment.construction,
  }
}

function buildArcInfo({
  segment,
  endpointId,
  vertex,
  objects,
}: {
  segment: ApiObject
  endpointId: number
  vertex: Coords2d
  objects: ApiObject[]
}): FilletSegmentInfo | null {
  if (!isArcSegment(segment)) {
    return null
  }

  const arcPoints = getArcPoints(segment, objects)
  const endpointName = endpointNameForId(segment, endpointId)
  if (!arcPoints || !endpointName || arcPoints.isCircle) {
    return null
  }

  const radius = distance2d(arcPoints.center, arcPoints.start)
  if (radius <= EPSILON) {
    return null
  }

  const startAngle = Math.atan2(
    arcPoints.start[1] - arcPoints.center[1],
    arcPoints.start[0] - arcPoints.center[0]
  )
  const endAngle = Math.atan2(
    arcPoints.end[1] - arcPoints.center[1],
    arcPoints.end[0] - arcPoints.center[0]
  )
  const sweep = getAngleDiff(startAngle, endAngle, true)
  if (sweep <= EPSILON) {
    return null
  }

  const endpointRadius = subVec(vertex, arcPoints.center)
  const tangentAway =
    endpointName === 'start'
      ? normalizeVec(perpendicular(endpointRadius))
      : normalizeVec(scaleVec(perpendicular(endpointRadius), -1))
  if (!isValidUnitVector(tangentAway)) {
    return null
  }

  return {
    segmentId: segment.id,
    endpointId,
    endpointName,
    kind: 'arc',
    vertex,
    otherPoint: endpointName === 'start' ? arcPoints.end : arcPoints.start,
    tangentAway,
    length: radius * sweep,
    construction: segment.kind.segment.construction,
    arc: {
      center: arcPoints.center,
      radius,
      start: arcPoints.start,
      end: arcPoints.end,
      sharedAt: endpointName,
    },
  }
}

function buildSegmentInfo({
  segment,
  endpointId,
  vertex,
  objects,
}: {
  segment: ApiObject
  endpointId: number
  vertex: Coords2d
  objects: ApiObject[]
}) {
  return (
    buildLineInfo({ segment, endpointId, vertex, objects }) ??
    buildArcInfo({ segment, endpointId, vertex, objects })
  )
}

function getDimensionConstraintsForFillet({
  sides,
  objects,
}: {
  sides: [FilletSegmentInfo, FilletSegmentInfo]
  objects: ApiObject[]
}): FilletSelection['dimensionConstraints'] {
  const replacementPointIds = new Set(
    sides.flatMap((side) => [...pointIdCluster(side.endpointId, objects)])
  )

  return objects
    .filter(isDistanceConstraint)
    .map((obj) => {
      const replacePointIds = obj.kind.constraint.points.filter(
        (point): point is number =>
          typeof point === 'number' && replacementPointIds.has(point)
      )
      if (replacePointIds.length === 0) {
        return null
      }

      return {
        constraintId: obj.id,
        constraint: {
          ...obj.kind.constraint,
          points: [...obj.kind.constraint.points],
        },
        replacePointIds,
      }
    })
    .filter((constraint) => constraint !== null)
}

export function resolveFilletSelection({
  segmentIds,
  objects,
}: {
  segmentIds: [number, number]
  objects: ApiObject[]
}): FilletSelection | null {
  const [firstId, secondId] = segmentIds
  if (firstId === secondId) {
    return null
  }

  const first = objects[firstId]
  const second = objects[secondId]
  if (!first || !second) {
    return null
  }

  if (isCircleSegment(first) || isCircleSegment(second)) {
    return null
  }

  if (
    (!isLineSegment(first) && !isArcSegment(first)) ||
    (!isLineSegment(second) && !isArcSegment(second))
  ) {
    return null
  }

  const shared = getSharedEndpointInfo({ first, second, objects })
  if (!shared) {
    return null
  }

  const firstSide = buildSegmentInfo({
    segment: first,
    endpointId: shared.firstEndpointId,
    vertex: shared.vertex,
    objects,
  })
  const secondSide = buildSegmentInfo({
    segment: second,
    endpointId: shared.secondEndpointId,
    vertex: shared.vertex,
    objects,
  })
  if (!firstSide || !secondSide) {
    return null
  }

  if (
    Math.abs(cross2d(firstSide.tangentAway, secondSide.tangentAway)) <= EPSILON
  ) {
    return null
  }

  return {
    segmentIds,
    sides: [firstSide, secondSide],
    vertex: shared.vertex,
    adjacencyConstraintIds: shared.adjacencyConstraintIds,
    dimensionConstraints: getDimensionConstraintsForFillet({
      sides: [firstSide, secondSide],
      objects,
    }),
  }
}

function distanceAlongSide(side: FilletSegmentInfo, point: Coords2d) {
  if (side.kind === 'line') {
    return dot2d(subVec(point, side.vertex), side.tangentAway)
  }

  const arc = side.arc
  if (!arc) {
    return Number.NaN
  }

  const pointAngle = Math.atan2(
    point[1] - arc.center[1],
    point[0] - arc.center[0]
  )
  const baseAngle =
    side.endpointName === 'start'
      ? Math.atan2(arc.start[1] - arc.center[1], arc.start[0] - arc.center[0])
      : Math.atan2(arc.end[1] - arc.center[1], arc.end[0] - arc.center[0])
  const angleDistance =
    side.endpointName === 'start'
      ? getAngleDiff(baseAngle, pointAngle, true)
      : getAngleDiff(baseAngle, pointAngle, false)
  return angleDistance * arc.radius
}

function offsetCurveForSide(
  side: FilletSegmentInfo,
  radius: number,
  sign: -1 | 1
): OffsetCurve | null {
  if (side.kind === 'line') {
    return {
      type: 'line',
      point: addVec(
        side.vertex,
        scaleVec(perpendicular(side.tangentAway), sign * radius)
      ),
      direction: side.tangentAway,
    }
  }

  const arc = side.arc
  if (!arc) {
    return null
  }

  const offsetRadius = arc.radius + sign * radius
  if (offsetRadius <= EPSILON) {
    return null
  }

  return {
    type: 'circle',
    center: arc.center,
    radius: offsetRadius,
  }
}

function intersectLines(
  first: Extract<OffsetCurve, { type: 'line' }>,
  second: Extract<OffsetCurve, { type: 'line' }>
): Coords2d[] {
  const denominator = cross2d(first.direction, second.direction)
  if (Math.abs(denominator) <= EPSILON) {
    return []
  }

  const delta = subVec(second.point, first.point)
  const t = cross2d(delta, second.direction) / denominator
  return [addVec(first.point, scaleVec(first.direction, t))]
}

function intersectLineCircle(
  line: Extract<OffsetCurve, { type: 'line' }>,
  circle: Extract<OffsetCurve, { type: 'circle' }>
): Coords2d[] {
  const fromCenter = subVec(line.point, circle.center)
  const a = dot2d(line.direction, line.direction)
  const b = 2 * dot2d(fromCenter, line.direction)
  const c = dot2d(fromCenter, fromCenter) - circle.radius * circle.radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < -EPSILON) {
    return []
  }

  if (Math.abs(discriminant) <= EPSILON) {
    const t = -b / (2 * a)
    return [addVec(line.point, scaleVec(line.direction, t))]
  }

  const sqrtDiscriminant = Math.sqrt(discriminant)
  const t1 = (-b - sqrtDiscriminant) / (2 * a)
  const t2 = (-b + sqrtDiscriminant) / (2 * a)
  return [
    addVec(line.point, scaleVec(line.direction, t1)),
    addVec(line.point, scaleVec(line.direction, t2)),
  ]
}

function intersectCircles(
  first: Extract<OffsetCurve, { type: 'circle' }>,
  second: Extract<OffsetCurve, { type: 'circle' }>
): Coords2d[] {
  const delta = subVec(second.center, first.center)
  const centerDistance = length2d(delta)
  if (centerDistance <= EPSILON) {
    return []
  }

  if (
    centerDistance > first.radius + second.radius + EPSILON ||
    centerDistance < Math.abs(first.radius - second.radius) - EPSILON
  ) {
    return []
  }

  const a =
    (first.radius * first.radius -
      second.radius * second.radius +
      centerDistance * centerDistance) /
    (2 * centerDistance)
  const hSquared = first.radius * first.radius - a * a
  if (hSquared < -EPSILON) {
    return []
  }

  const unit = scaleVec(delta, 1 / centerDistance)
  const base = addVec(first.center, scaleVec(unit, a))
  if (Math.abs(hSquared) <= EPSILON) {
    return [base]
  }

  const h = Math.sqrt(hSquared)
  const normal = perpendicular(unit)
  return [addVec(base, scaleVec(normal, h)), addVec(base, scaleVec(normal, -h))]
}

function intersectOffsetCurves(first: OffsetCurve, second: OffsetCurve) {
  if (first.type === 'line' && second.type === 'line') {
    return intersectLines(first, second)
  }

  if (first.type === 'line' && second.type === 'circle') {
    return intersectLineCircle(first, second)
  }

  if (first.type === 'circle' && second.type === 'line') {
    return intersectLineCircle(second, first)
  }

  if (first.type === 'circle' && second.type === 'circle') {
    return intersectCircles(first, second)
  }

  return []
}

function tangentPointForCenter(side: FilletSegmentInfo, center: Coords2d) {
  if (side.kind === 'line') {
    const distance = dot2d(subVec(center, side.vertex), side.tangentAway)
    return addVec(side.vertex, scaleVec(side.tangentAway, distance))
  }

  const arc = side.arc
  if (!arc) {
    return null
  }

  const radial = normalizeVec(subVec(center, arc.center))
  if (!isValidUnitVector(radial)) {
    return null
  }

  return addVec(arc.center, scaleVec(radial, arc.radius))
}

function resolveArcEndpoints({
  center,
  sideTangencies,
}: {
  center: Coords2d
  sideTangencies: [Coords2d, Coords2d]
}): Pick<FilletGeometry, 'arcStart' | 'arcEnd' | 'arcStartSideIndex'> {
  const angle0 = Math.atan2(
    sideTangencies[0][1] - center[1],
    sideTangencies[0][0] - center[0]
  )
  const angle1 = Math.atan2(
    sideTangencies[1][1] - center[1],
    sideTangencies[1][0] - center[0]
  )
  const ccwSweep = getAngleDiff(angle0, angle1, true)

  if (ccwSweep <= Math.PI) {
    return {
      arcStart: sideTangencies[0],
      arcEnd: sideTangencies[1],
      arcStartSideIndex: 0,
    }
  }

  return {
    arcStart: sideTangencies[1],
    arcEnd: sideTangencies[0],
    arcStartSideIndex: 1,
  }
}

function candidateScore({
  geometry,
  mousePosition,
  selection,
}: {
  geometry: FilletGeometry
  mousePosition?: Coords2d
  selection: FilletSelection
}) {
  if (mousePosition) {
    return distance2d(mousePosition, geometry.center)
  }

  return (
    distanceAlongSide(selection.sides[0], geometry.sideTangencies[0]) +
    distanceAlongSide(selection.sides[1], geometry.sideTangencies[1])
  )
}

export function solveFilletGeometry({
  selection,
  radius,
  mousePosition,
}: {
  selection: FilletSelection
  radius: number
  mousePosition?: Coords2d
}): FilletGeometry | null {
  if (!Number.isFinite(radius) || radius <= MIN_FILLET_RADIUS) {
    return null
  }

  const candidates: FilletGeometry[] = []

  for (const firstSign of [-1, 1] as const) {
    const firstOffset = offsetCurveForSide(
      selection.sides[0],
      radius,
      firstSign
    )
    if (!firstOffset) {
      continue
    }

    for (const secondSign of [-1, 1] as const) {
      const secondOffset = offsetCurveForSide(
        selection.sides[1],
        radius,
        secondSign
      )
      if (!secondOffset) {
        continue
      }

      for (const center of intersectOffsetCurves(firstOffset, secondOffset)) {
        const firstTangent = tangentPointForCenter(selection.sides[0], center)
        const secondTangent = tangentPointForCenter(selection.sides[1], center)
        if (!firstTangent || !secondTangent) {
          continue
        }

        const firstDistance = distanceAlongSide(
          selection.sides[0],
          firstTangent
        )
        const secondDistance = distanceAlongSide(
          selection.sides[1],
          secondTangent
        )
        if (
          firstDistance <= EPSILON ||
          secondDistance <= EPSILON ||
          firstDistance >= selection.sides[0].length - EPSILON ||
          secondDistance >= selection.sides[1].length - EPSILON
        ) {
          continue
        }

        if (
          Math.abs(distance2d(center, firstTangent) - radius) > 1e-4 ||
          Math.abs(distance2d(center, secondTangent) - radius) > 1e-4
        ) {
          continue
        }

        const sideTangencies = [firstTangent, secondTangent] as [
          Coords2d,
          Coords2d,
        ]
        const endpoints = resolveArcEndpoints({ center, sideTangencies })
        if (
          coordsAlmostEqual(endpoints.arcStart, endpoints.arcEnd) ||
          distance2d(center, selection.vertex) < radius - EPSILON
        ) {
          continue
        }

        candidates.push({
          radius,
          center,
          sideTangencies,
          ...endpoints,
        })
      }
    }
  }

  if (candidates.length === 0) {
    return null
  }

  return candidates.sort(
    (left, right) =>
      candidateScore({ geometry: left, mousePosition, selection }) -
      candidateScore({ geometry: right, mousePosition, selection })
  )[0]
}

export function solveFilletGeometryFromMouse({
  selection,
  mousePosition,
}: {
  selection: FilletSelection
  mousePosition: Coords2d
}): FilletGeometry | null {
  const rawRadius = Math.max(
    MIN_FILLET_RADIUS,
    distance2d(mousePosition, selection.vertex)
  )
  const directGeometry = solveFilletGeometry({
    selection,
    radius: rawRadius,
    mousePosition,
  })
  if (directGeometry) {
    return directGeometry
  }

  let low = MIN_FILLET_RADIUS
  let high = rawRadius
  let best: FilletGeometry | null = null

  for (let index = 0; index < FILLET_RADIUS_SEARCH_STEPS; index++) {
    const radius = (low + high) / 2
    const geometry = solveFilletGeometry({ selection, radius, mousePosition })
    if (geometry) {
      best = geometry
      low = radius
    } else {
      high = radius
    }
  }

  return best
}

function getInitialFilletGeometry(selection: FilletSelection) {
  const maxReasonableRadius =
    Math.min(selection.sides[0].length, selection.sides[1].length) / 3
  return (
    solveFilletGeometry({
      selection,
      radius: Math.max(
        MIN_FILLET_RADIUS * 2,
        Math.min(DEFAULT_FILLET_RADIUS, maxReasonableRadius)
      ),
    }) ??
    solveFilletGeometry({
      selection,
      radius: Math.max(MIN_FILLET_RADIUS * 2, maxReasonableRadius / 2),
    })
  )
}

function findFilletTarget({
  mousePosition,
  sceneGraphDelta,
  sketchId,
  sceneInfra,
  excludedIds = [],
}: {
  mousePosition: Coords2d
  sceneGraphDelta: SceneGraphDelta
  sketchId: number
  sceneInfra: SceneInfra
  excludedIds?: number[]
}): ApiObject | null {
  const excludedIdSet = new Set(excludedIds)
  const apiObjects = getCurrentSketchObjectsById(
    sceneGraphDelta.new_graph.objects,
    sketchId
  )
  const closestObjects = findClosestApiObjects(
    mousePosition,
    apiObjects,
    sceneInfra
  )

  for (const closestObject of closestObjects) {
    const apiObject = closestObject.apiObject
    if (excludedIdSet.has(apiObject.id)) {
      continue
    }

    if (isLineSegment(apiObject) || isArcSegment(apiObject)) {
      return apiObject
    }

    if (isPointSegment(apiObject) && apiObject.kind.segment.owner !== null) {
      const owner =
        sceneGraphDelta.new_graph.objects[apiObject.kind.segment.owner]
      if (
        owner &&
        !excludedIdSet.has(owner.id) &&
        (isLineSegment(owner) || isArcSegment(owner))
      ) {
        return owner
      }
    }
  }

  return null
}

function getParentSceneGraph(self: ToolActionArgs['self']) {
  return self._parent?.getSnapshot()?.context?.sketchExecOutcome
    ?.sceneGraphDelta
}

function sendHoveredSegment({
  self,
  segment,
}: {
  self: ToolActionArgs['self']
  segment: ApiObject | null
}) {
  if (!segment) {
    sendHoveredSnappingCandidate(self, null)
    return
  }

  self._parent?.send({
    type: 'update hovered id',
    data: {
      hoveredId: segment.id,
    },
  })
}

export function tryResolveInitialSelection(
  context: ToolContext
): FilletSelection | null {
  const selectedIds = getInitialSegmentSelectionIds(context)
  if (selectedIds.length !== 2 || !context.initialObjects) {
    return null
  }

  return resolveFilletSelection({
    segmentIds: [selectedIds[0], selectedIds[1]],
    objects: context.initialObjects,
  })
}

function getInitialSegmentSelectionIds(context: ToolContext) {
  return (
    context.initialSelectionIds?.filter(
      (id): id is number => typeof id === 'number'
    ) ?? []
  )
}

export function tryResolveInitialFirstSegment(
  context: ToolContext
): number | null {
  const selectedIds = getInitialSegmentSelectionIds(context)
  if (selectedIds.length !== 1 || !context.initialObjects) {
    return null
  }

  const selectedObject = context.initialObjects[selectedIds[0]]
  return isLineSegment(selectedObject) || isArcSegment(selectedObject)
    ? selectedIds[0]
    : null
}

export function addFirstSegmentListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) {
        return
      }
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) {
        return
      }

      const sceneGraphDelta = getParentSceneGraph(self)
      if (!sceneGraphDelta) {
        return
      }

      const target = findFilletTarget({
        mousePosition: [twoD.x, twoD.y],
        sceneGraphDelta,
        sketchId: context.sketchId,
        sceneInfra: context.sceneInfra,
      })
      if (!target) {
        return
      }

      self._parent?.send({
        type: 'update selected ids',
        data: { selectedIds: [target.id], duringAreaSelectIds: [] },
      })
      self.send({
        type: 'select first segment',
        data: target.id,
      })
    },
    onMove: (args: OnMoveCallbackArgs) => {
      const twoD = args.intersectionPoint?.twoD
      const sceneGraphDelta = getParentSceneGraph(self)
      if (!twoD || !sceneGraphDelta) {
        clearToolSnappingState({ self, sceneInfra: context.sceneInfra })
        return
      }

      const target = findFilletTarget({
        mousePosition: [twoD.x, twoD.y],
        sceneGraphDelta,
        sketchId: context.sketchId,
        sceneInfra: context.sceneInfra,
      })
      sendHoveredSegment({ self, segment: target })
    },
  })
}

export function addSecondSegmentListener({ self, context }: ToolActionArgs) {
  if (context.firstSegmentId === undefined) {
    return
  }

  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) {
        return
      }
      const twoD = args.intersectionPoint?.twoD
      if (!twoD || context.firstSegmentId === undefined) {
        return
      }

      const sceneGraphDelta = getParentSceneGraph(self)
      if (!sceneGraphDelta) {
        return
      }

      const target = findFilletTarget({
        mousePosition: [twoD.x, twoD.y],
        sceneGraphDelta,
        sketchId: context.sketchId,
        sceneInfra: context.sceneInfra,
        excludedIds: [context.firstSegmentId],
      })
      if (!target) {
        return
      }

      const selection = resolveFilletSelection({
        segmentIds: [context.firstSegmentId, target.id],
        objects: sceneGraphDelta.new_graph.objects,
      })
      if (!selection) {
        toastSketchSolveError(
          new Error('Select two adjacent line or arc segments for Fillet')
        )
        return
      }

      self._parent?.send({
        type: 'update selected ids',
        data: {
          selectedIds: [context.firstSegmentId, target.id],
          duringAreaSelectIds: [],
        },
      })
      self.send({
        type: 'select fillet pair',
        data: selection,
      })
    },
    onMove: (args: OnMoveCallbackArgs) => {
      const twoD = args.intersectionPoint?.twoD
      const sceneGraphDelta = getParentSceneGraph(self)
      if (!twoD || !sceneGraphDelta || context.firstSegmentId === undefined) {
        clearToolSnappingState({ self, sceneInfra: context.sceneInfra })
        return
      }

      const target = findFilletTarget({
        mousePosition: [twoD.x, twoD.y],
        sceneGraphDelta,
        sketchId: context.sketchId,
        sceneInfra: context.sceneInfra,
        excludedIds: [context.firstSegmentId],
      })
      sendHoveredSegment({ self, segment: target })
    },
  })
}

export function addRadiusListener({ self, context }: ToolActionArgs) {
  if (!context.selection || !context.draft) {
    return
  }

  self._parent?.send({
    type: 'update hovered id',
    data: { hoveredId: null },
  })

  let isEditInProgress = false
  let latestGeometry = context.currentGeometry
  let cachedSettings: AppSettings | null = null

  const updateDraftArc = async (geometry: FilletGeometry) => {
    if (!context.draft) {
      return
    }
    if (!cachedSettings) {
      cachedSettings = jsAppSettings(context.rustContext.settingsActor)
    }

    const units = baseUnitToNumericSuffix(
      context.kclManager.fileSettings.defaultLengthUnit
    )
    const result = await context.rustContext.editSegments(
      0,
      context.sketchId,
      [
        {
          id: context.draft.arcId,
          ctor: arcCtor({
            start: geometry.arcStart,
            end: geometry.arcEnd,
            center: geometry.center,
            units,
          }),
        },
      ],
      cachedSettings
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
  }

  context.sceneInfra.setCallbacks({
    onMove: async (args) => {
      if (!args || isEditInProgress || !context.selection) {
        return
      }
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) {
        clearToolSnappingState({ self, sceneInfra: context.sceneInfra })
        return
      }

      const geometry = solveFilletGeometryFromMouse({
        selection: context.selection,
        mousePosition: [twoD.x, twoD.y],
      })
      if (!geometry) {
        return
      }

      latestGeometry = geometry
      try {
        isEditInProgress = true
        await updateDraftArc(geometry)
      } catch (error) {
        console.error('failed to update fillet preview', error)
      } finally {
        isEditInProgress = false
      }
    },
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1 || !context.selection) {
        return
      }
      const twoD = args.intersectionPoint?.twoD
      const geometry = twoD
        ? solveFilletGeometryFromMouse({
            selection: context.selection,
            mousePosition: [twoD.x, twoD.y],
          })
        : latestGeometry
      if (!geometry) {
        toastSketchSolveError(
          new Error(
            'Could not fit a fillet of that radius between these segments'
          )
        )
        return
      }

      self.send({
        type: 'confirm fillet radius',
        data: geometry,
      })
    },
  })
}

export function removeFilletListeners({ context, self }: ToolActionArgs) {
  clearToolSnappingState({ self, sceneInfra: context.sceneInfra })
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export function sendResultToParent({ event, self }: ToolActionArgs) {
  if (!('output' in event) || !event.output || 'error' in event.output) {
    return
  }

  const sendData: SketchSolveMachineEvent = {
    type: 'update sketch outcome',
    data: {
      sourceDelta: event.output.kclSource,
      sceneGraphDelta: event.output.sceneGraphDelta,
      checkpointId: event.output.checkpointId ?? null,
      ...(event.type !== FINALIZING_FILLET ? { writeToDisk: false } : {}),
    },
  }
  self._parent?.send(sendData)
}

export function storeInitialSelection({
  context,
}: ToolAssignArgs): Partial<ToolContext> {
  const selection = tryResolveInitialSelection(context)
  return selection ? { selection } : {}
}

export function storeInitialFirstSegment({
  context,
}: ToolAssignArgs): Partial<ToolContext> {
  const firstSegmentId = tryResolveInitialFirstSegment(context)
  return firstSegmentId === null ? {} : { firstSegmentId }
}

export function storeFirstSegment({
  event,
}: ToolAssignArgs): Partial<ToolContext> {
  if (event.type !== 'select first segment') {
    return {}
  }

  return {
    firstSegmentId: event.data,
  }
}

export function storeSelectedPair({
  event,
}: ToolAssignArgs): Partial<ToolContext> {
  if (event.type !== 'select fillet pair') {
    return {}
  }

  return {
    selection: event.data,
  }
}

export function storeCreatedFilletArc({
  event,
  self,
}: ToolAssignArgs): Partial<ToolContext> {
  if (!('output' in event) || !event.output || 'error' in event.output) {
    return {}
  }

  const { draft } = event.output
  if (!draft) {
    return {}
  }

  self._parent?.send({
    type: 'set draft entities',
    data: {
      segmentIds: draft.segmentIds,
      constraintIds: [],
    },
  })

  return {
    draft,
  }
}

export function storeConfirmedGeometry({
  event,
}: ToolAssignArgs): Partial<ToolContext> {
  if (event.type !== 'confirm fillet radius') {
    return {}
  }

  return {
    currentGeometry: event.data,
  }
}

function getArcDraftFromDelta({
  sceneGraphDelta,
  sketchId,
}: {
  sceneGraphDelta: SceneGraphDelta
  sketchId: number
}): FilletArcDraft | null {
  const sketch = sceneGraphDelta.new_graph.objects[sketchId]
  const newObjectIds = new Set(sceneGraphDelta.new_objects)
  const sketchNewSegmentIds =
    sketch?.kind.type === 'Sketch'
      ? sketch.kind.segments.filter((segmentId) => newObjectIds.has(segmentId))
      : []
  const candidateArcIds =
    sketchNewSegmentIds.length > 0
      ? sketchNewSegmentIds
      : sceneGraphDelta.new_objects

  const arcId = [...candidateArcIds]
    .reverse()
    .find((objId) => isArcSegment(sceneGraphDelta.new_graph.objects[objId]))
  if (arcId === undefined) {
    return null
  }

  const arc = sceneGraphDelta.new_graph.objects[arcId]
  if (!isArcSegment(arc)) {
    return null
  }

  return {
    arcId,
    arcStartPointId: arc.kind.segment.start,
    arcEndPointId: arc.kind.segment.end,
    arcCenterPointId: arc.kind.segment.center,
    segmentIds: [
      arcId,
      arc.kind.segment.start,
      arc.kind.segment.end,
      arc.kind.segment.center,
    ],
  }
}

export async function createFilletArcActor({
  input,
}: {
  input:
    | {
        selection: FilletSelection
        rustContext: RustContext
        kclManager: KclManager
        sketchId: number
      }
    | ErrorOutput
}): Promise<
  | {
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
      draft: FilletArcDraft
    }
  | ErrorOutput
> {
  if ('error' in input) {
    return input
  }

  const geometry = getInitialFilletGeometry(input.selection)
  if (!geometry) {
    return { error: 'Could not fit a fillet between these segments' }
  }

  const units = baseUnitToNumericSuffix(
    input.kclManager.fileSettings.defaultLengthUnit
  )
  const settings = jsAppSettings(input.rustContext.settingsActor)
  const result = await input.rustContext.addSegment(
    0,
    input.sketchId,
    arcCtor({
      start: geometry.arcStart,
      end: geometry.arcEnd,
      center: geometry.center,
      units,
    }),
    'fillet-arc-segment',
    settings
  )
  const draft = getArcDraftFromDelta({
    sceneGraphDelta: result.sceneGraphDelta,
    sketchId: input.sketchId,
  })
  if (!draft) {
    return { error: 'Failed to create fillet preview arc' }
  }

  return {
    ...result,
    draft,
  }
}

function buildTrimmedSegmentEdit({
  side,
  tangentPoint,
  units,
}: {
  side: FilletSegmentInfo
  tangentPoint: Coords2d
  units: NumericSuffix
}): { id: number; ctor: SegmentCtor } | null {
  if (side.kind === 'line') {
    return {
      id: side.segmentId,
      ctor: lineCtor({
        start: side.endpointName === 'start' ? tangentPoint : side.otherPoint,
        end: side.endpointName === 'end' ? tangentPoint : side.otherPoint,
        units,
        construction: side.construction,
      }),
    }
  }

  if (side.arc) {
    return {
      id: side.segmentId,
      ctor: arcCtor({
        start: side.endpointName === 'start' ? tangentPoint : side.otherPoint,
        end: side.endpointName === 'end' ? tangentPoint : side.otherPoint,
        center: side.arc.center,
        units,
        construction: side.construction,
      }),
    }
  }

  return null
}

async function deleteConstraints({
  constraintIds,
  rustContext,
  sketchId,
  settings,
}: {
  constraintIds: number[]
  rustContext: RustContext
  sketchId: number
  settings: AppSettings
}) {
  if (constraintIds.length === 0) {
    return null
  }

  return rustContext.deleteObjects(0, sketchId, constraintIds, [], settings)
}

function remapObjectIdAfterDeletedConstraints(
  id: number,
  deletedConstraintIds: number[]
) {
  return (
    id -
    deletedConstraintIds.filter(
      (deletedConstraintId) => deletedConstraintId < id
    ).length
  )
}

function remapSegmentInfoAfterDeletedConstraints(
  side: FilletSegmentInfo,
  deletedConstraintIds: number[]
): FilletSegmentInfo {
  return {
    ...side,
    segmentId: remapObjectIdAfterDeletedConstraints(
      side.segmentId,
      deletedConstraintIds
    ),
    endpointId: remapObjectIdAfterDeletedConstraints(
      side.endpointId,
      deletedConstraintIds
    ),
  }
}

function remapSelectionAfterDeletedConstraints({
  selection,
  deletedConstraintIds,
}: {
  selection: FilletSelection
  deletedConstraintIds: number[]
}): FilletSelection {
  if (deletedConstraintIds.length === 0) {
    return selection
  }

  return {
    ...selection,
    segmentIds: [
      remapObjectIdAfterDeletedConstraints(
        selection.segmentIds[0],
        deletedConstraintIds
      ),
      remapObjectIdAfterDeletedConstraints(
        selection.segmentIds[1],
        deletedConstraintIds
      ),
    ],
    sides: [
      remapSegmentInfoAfterDeletedConstraints(
        selection.sides[0],
        deletedConstraintIds
      ),
      remapSegmentInfoAfterDeletedConstraints(
        selection.sides[1],
        deletedConstraintIds
      ),
    ],
    adjacencyConstraintIds: [],
  }
}

function refreshDraftFromArcObject({
  draft,
  arc,
}: {
  draft: FilletArcDraft
  arc: ApiObject | undefined
}): FilletArcDraft | null {
  if (!isArcSegment(arc)) {
    return null
  }

  return {
    ...draft,
    arcId: arc.id,
    arcStartPointId: arc.kind.segment.start,
    arcEndPointId: arc.kind.segment.end,
    arcCenterPointId: arc.kind.segment.center,
    segmentIds: [
      arc.id,
      arc.kind.segment.start,
      arc.kind.segment.end,
      arc.kind.segment.center,
    ],
  }
}

function remapDraftAfterDeletedConstraints({
  draft,
  deletedConstraintIds,
  sceneGraphDelta,
}: {
  draft: FilletArcDraft
  deletedConstraintIds: number[]
  sceneGraphDelta: SceneGraphDelta | null
}): FilletArcDraft | null {
  if (deletedConstraintIds.length === 0 || !sceneGraphDelta) {
    return draft
  }

  const remappedArcId = remapObjectIdAfterDeletedConstraints(
    draft.arcId,
    deletedConstraintIds
  )

  return refreshDraftFromArcObject({
    draft: { ...draft, arcId: remappedArcId },
    arc: sceneGraphDelta.new_graph.objects[remappedArcId],
  })
}

function getEndpointPointIdForSide(
  side: FilletSegmentInfo,
  objects: ApiObject[]
) {
  const segment = objects[side.segmentId]
  if (!isLineSegment(segment) && !isArcSegment(segment)) {
    return null
  }

  return side.endpointName === 'start'
    ? segment.kind.segment.start
    : segment.kind.segment.end
}

function getArcPointIdForSide({
  geometry,
  arc,
  sideIndex,
}: {
  geometry: FilletGeometry
  arc: ApiObject | undefined
  sideIndex: 0 | 1
}) {
  if (!isArcSegment(arc)) {
    return null
  }

  const sideIsArcStart = geometry.arcStartSideIndex === sideIndex
  return sideIsArcStart ? arc.kind.segment.start : arc.kind.segment.end
}

function constructionArcCtorForSide({
  side,
  tangentPoint,
  units,
}: {
  side: FilletSegmentInfo
  tangentPoint: Coords2d
  units: NumericSuffix
}): SegmentCtor | null {
  const arc = side.arc
  if (!arc) {
    return null
  }

  return arcCtor({
    start: side.endpointName === 'start' ? side.vertex : tangentPoint,
    end: side.endpointName === 'start' ? tangentPoint : side.vertex,
    center: arc.center,
    units,
    construction: true,
  })
}

function getConstructionArcIds({
  sceneGraphDelta,
  side,
  constructionId,
}: {
  sceneGraphDelta: SceneGraphDelta
  side: FilletSegmentInfo
  constructionId: number
}): {
  vertexPointId: number
  tangentPointId: number
  centerPointId: number
} | null {
  const obj = sceneGraphDelta.new_graph.objects[constructionId]
  if (!isArcSegment(obj)) {
    return null
  }

  const endpointIds =
    side.endpointName === 'start'
      ? {
          vertexPointId: obj.kind.segment.start,
          tangentPointId: obj.kind.segment.end,
        }
      : {
          vertexPointId: obj.kind.segment.end,
          tangentPointId: obj.kind.segment.start,
        }

  return {
    ...endpointIds,
    centerPointId: obj.kind.segment.center,
  }
}

function getNewSegmentId(
  sceneGraphDelta: SceneGraphDelta,
  predicate: (obj: ApiObject | undefined) => boolean
) {
  return [...sceneGraphDelta.new_objects]
    .reverse()
    .find((objId) => predicate(sceneGraphDelta.new_graph.objects[objId]))
}

async function addConstraintAndTrack({
  constraint,
  rustContext,
  sketchId,
  settings,
  createCheckpoint,
  newObjects,
}: {
  constraint: ApiConstraint
  rustContext: RustContext
  sketchId: number
  settings: AppSettings
  createCheckpoint?: boolean
  newObjects: number[]
}) {
  const result = await rustContext.addConstraint(
    0,
    sketchId,
    constraint,
    settings,
    createCheckpoint
  )
  newObjects.push(...result.sceneGraphDelta.new_objects)
  return result
}

function remapConstraintSegmentAfterDeletedConstraints({
  segment,
  deletedConstraintIds,
}: {
  segment: DistanceApiConstraint['points'][number]
  deletedConstraintIds: number[]
}) {
  return typeof segment === 'number'
    ? remapObjectIdAfterDeletedConstraints(segment, deletedConstraintIds)
    : segment
}

function buildInheritedDimensionConstraint({
  dimensionConstraint,
  intersectionPointId,
  deletedConstraintIds,
}: {
  dimensionConstraint: FilletSelection['dimensionConstraints'][number]
  intersectionPointId: number
  deletedConstraintIds: number[]
}): DistanceApiConstraint | null {
  const replacePointIds = new Set(dimensionConstraint.replacePointIds)
  const points = dimensionConstraint.constraint.points.map((point) => {
    if (typeof point === 'number' && replacePointIds.has(point)) {
      return intersectionPointId
    }

    return remapConstraintSegmentAfterDeletedConstraints({
      segment: point,
      deletedConstraintIds,
    })
  })

  if (new Set(points.map((point) => String(point))).size < 2) {
    return null
  }

  return {
    ...dimensionConstraint.constraint,
    points,
  }
}

export async function finalizeFilletActor({
  input,
}: {
  input:
    | {
        selection: FilletSelection
        geometry: FilletGeometry
        draft: FilletArcDraft
        rustContext: RustContext
        kclManager: KclManager
        sketchId: number
      }
    | ErrorOutput
}): Promise<
  | {
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
      checkpointId?: number | null
    }
  | ErrorOutput
> {
  if ('error' in input) {
    return input
  }

  const { selection, geometry, draft, rustContext, kclManager, sketchId } =
    input
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )
  const settings = jsAppSettings(rustContext.settingsActor)

  try {
    const constraintIdsToDelete = [
      ...new Set([
        ...selection.adjacencyConstraintIds,
        ...selection.dimensionConstraints.map(
          (dimensionConstraint) => dimensionConstraint.constraintId
        ),
      ]),
    ]
    const deleteResult = await deleteConstraints({
      constraintIds: constraintIdsToDelete,
      rustContext,
      sketchId,
      settings,
    })
    const deletedConstraintIds = deleteResult ? constraintIdsToDelete : []
    const currentSelection = remapSelectionAfterDeletedConstraints({
      selection,
      deletedConstraintIds,
    })
    const currentDraft = remapDraftAfterDeletedConstraints({
      draft,
      deletedConstraintIds,
      sceneGraphDelta: deleteResult?.sceneGraphDelta ?? null,
    })
    if (!currentDraft) {
      return {
        error:
          'Failed to find fillet preview arc after deleting corner constraint',
      }
    }

    const segmentEdits = currentSelection.sides.map((side, index) =>
      buildTrimmedSegmentEdit({
        side,
        tangentPoint: geometry.sideTangencies[index as 0 | 1],
        units,
      })
    )
    if (!segmentEdits[0] || !segmentEdits[1]) {
      return { error: 'Failed to build fillet segment edits' }
    }

    const editResult = await rustContext.editSegments(
      0,
      sketchId,
      [
        segmentEdits[0],
        segmentEdits[1],
        {
          id: currentDraft.arcId,
          ctor: arcCtor({
            start: geometry.arcStart,
            end: geometry.arcEnd,
            center: geometry.center,
            units,
          }),
        },
      ],
      settings
    )

    const newObjects = [
      ...(deleteResult?.sceneGraphDelta.new_objects ?? []),
      ...editResult.sceneGraphDelta.new_objects,
    ]
    let latestKclSource = editResult.kclSource
    let latestSceneGraphDelta = editResult.sceneGraphDelta
    let latestCheckpointId = editResult.checkpointId ?? null

    const intersectionPointResult = await rustContext.addSegment(
      0,
      sketchId,
      pointCtor({
        position: currentSelection.vertex,
        units,
      }),
      'fillet-intersection-point',
      settings
    )
    newObjects.push(...intersectionPointResult.sceneGraphDelta.new_objects)
    latestKclSource = intersectionPointResult.kclSource
    latestSceneGraphDelta = intersectionPointResult.sceneGraphDelta

    const intersectionPointId = getNewSegmentId(
      intersectionPointResult.sceneGraphDelta,
      isPointSegment
    )
    if (intersectionPointId === undefined) {
      return { error: 'Failed to create fillet intersection point' }
    }

    const constructionArcData: Array<{
      side: FilletSegmentInfo
      vertexPointId: number
      tangentPointId: number
      centerPointId: number
    }> = []

    for (const [index, side] of currentSelection.sides.entries()) {
      if (side.kind !== 'arc') {
        continue
      }

      const ctor = constructionArcCtorForSide({
        side,
        tangentPoint: geometry.sideTangencies[index as 0 | 1],
        units,
      })
      if (!ctor) {
        return { error: 'Failed to build fillet construction arc' }
      }

      const addResult = await rustContext.addSegment(
        0,
        sketchId,
        ctor,
        'fillet-construction-extension',
        settings
      )
      newObjects.push(...addResult.sceneGraphDelta.new_objects)
      latestKclSource = addResult.kclSource
      latestSceneGraphDelta = addResult.sceneGraphDelta

      const constructionId = getNewSegmentId(addResult.sceneGraphDelta, (obj) =>
        isArcSegment(obj)
      )
      if (constructionId === undefined) {
        return { error: 'Failed to create fillet construction arc' }
      }

      const constructionIds = getConstructionArcIds({
        sceneGraphDelta: addResult.sceneGraphDelta,
        side,
        constructionId,
      })
      if (!constructionIds) {
        return { error: 'Failed to find fillet construction arc points' }
      }

      constructionArcData.push({
        side,
        ...constructionIds,
      })
    }

    const endpointCoincidentConstraints: ApiConstraint[] = []
    const tangentConstraints: ApiConstraint[] = []
    const intersectionPointConstraints: ApiConstraint[] = []
    const constructionArcConstraints: ApiConstraint[] = []

    for (const [index, side] of currentSelection.sides.entries()) {
      const sideEndpointId = getEndpointPointIdForSide(
        side,
        latestSceneGraphDelta.new_graph.objects
      )
      const filletArcPointId = getArcPointIdForSide({
        geometry,
        arc: latestSceneGraphDelta.new_graph.objects[currentDraft.arcId],
        sideIndex: index as 0 | 1,
      })
      if (sideEndpointId === null || filletArcPointId === null) {
        return { error: 'Failed to find fillet endpoint' }
      }

      endpointCoincidentConstraints.push({
        type: 'Coincident',
        segments: [sideEndpointId, filletArcPointId],
      })
      tangentConstraints.push({
        type: 'Tangent',
        input: [side.segmentId, currentDraft.arcId],
      })
      if (side.kind === 'line') {
        intersectionPointConstraints.push({
          type: 'Coincident',
          segments: [side.segmentId, intersectionPointId],
        })
      }
    }

    for (const data of constructionArcData) {
      const sideEndpointId = getEndpointPointIdForSide(
        data.side,
        latestSceneGraphDelta.new_graph.objects
      )
      const sideArc =
        latestSceneGraphDelta.new_graph.objects[data.side.segmentId]
      if (sideEndpointId === null || !isArcSegment(sideArc)) {
        return { error: 'Failed to find fillet construction arc source' }
      }

      constructionArcConstraints.push(
        {
          type: 'Coincident',
          segments: [sideEndpointId, data.tangentPointId],
        },
        {
          type: 'Coincident',
          segments: [intersectionPointId, data.vertexPointId],
        },
        {
          type: 'Coincident',
          segments: [sideArc.kind.segment.center, data.centerPointId],
        }
      )
    }

    const constraintsToAdd = [
      ...endpointCoincidentConstraints,
      ...tangentConstraints,
      ...intersectionPointConstraints,
      ...constructionArcConstraints,
    ]

    for (const dimensionConstraint of selection.dimensionConstraints) {
      const inheritedConstraint = buildInheritedDimensionConstraint({
        dimensionConstraint,
        intersectionPointId,
        deletedConstraintIds,
      })
      if (inheritedConstraint) {
        constraintsToAdd.push(inheritedConstraint)
      }
    }

    for (const [index, constraint] of constraintsToAdd.entries()) {
      const constraintResult = await addConstraintAndTrack({
        constraint,
        rustContext,
        sketchId,
        settings,
        createCheckpoint: index === constraintsToAdd.length - 1,
        newObjects,
      })
      latestKclSource = constraintResult.kclSource
      latestSceneGraphDelta = constraintResult.sceneGraphDelta
      latestCheckpointId = constraintResult.checkpointId ?? latestCheckpointId
    }

    return {
      kclSource: latestKclSource,
      sceneGraphDelta: {
        ...latestSceneGraphDelta,
        invalidates_ids:
          latestSceneGraphDelta.invalidates_ids ||
          deleteResult?.sceneGraphDelta.invalidates_ids ||
          deletedConstraintIds.length > 0,
        new_objects: newObjects,
      },
      checkpointId: latestCheckpointId,
    }
  } catch (error) {
    console.error('Failed to finalize fillet:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
