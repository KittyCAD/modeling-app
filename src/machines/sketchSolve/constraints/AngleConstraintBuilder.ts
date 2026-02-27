import type {
  Number as ApiNumber,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import {
  addVec,
  clamp,
  cross2d,
  dot2d,
  lengthSq,
  lerp,
  normalizeVec,
  scaleVec,
  subVec,
} from '@src/lib/utils2d'
import { updateArcDimensionLine } from '@src/machines/sketchSolve/constraints/ArcDimensionLine'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import { createDimensionLine } from '@src/machines/sketchSolve/constraints/DimensionLine'
import {
  type AngleConstraint,
  getLineEndpoints,
  isAngleConstraint,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { Group } from 'three'

const ANGLE_RADIUS_SAMPLE = 0.2
const EPSILON = 1e-8

export class AngleConstraintBuilder {
  private readonly resources: ConstraintResources

  constructor(resources: ConstraintResources) {
    this.resources = resources
  }

  public init(obj: AngleConstraint) {
    return createDimensionLine(obj, this.resources)
  }

  public update(
    group: Group,
    obj: AngleConstraint,
    objects: ApiObject[],
    scale: number,
    sceneInfra: SceneInfra,
    selectedIds: number[],
    hoveredId: number | null
  ) {
    const angleConstraintData = calculateAngleConstraintData(obj, objects)
    if (!angleConstraintData) {
      group.visible = false
      return
    }

    this.resources.updateConstraintGroup(group, obj.id, selectedIds, hoveredId)
    updateArcDimensionLine(
      angleConstraintData,
      group,
      obj,
      scale,
      sceneInfra,
      obj.kind.constraint.angle
    )
  }
}

type RayInterval = {
  start: number
  end: number
}

type LineSegment = readonly [Coords2d, Coords2d]

export type AngleConstraintData = {
  center: Coords2d
  startDirection: Coords2d
  endDirection: Coords2d
  radius: number
}

// Computes the data needed to draw an angle constraint arc between two lines.
function calculateAngleConstraintData(
  obj: ApiObject,
  objects: ApiObject[]
): AngleConstraintData | null {
  if (!isAngleConstraint(obj)) {
    return null
  }

  const [lineId1, lineId2] = obj.kind.constraint.lines
  const line1Endpoints = getLineEndpoints(objects[lineId1], objects)
  const line2Endpoints = getLineEndpoints(objects[lineId2], objects)
  if (!line1Endpoints || !line2Endpoints) {
    return null
  }

  const line1 = [
    pointToCoords2d(line1Endpoints[0]),
    pointToCoords2d(line1Endpoints[1]),
  ] as const
  const line2 = [
    pointToCoords2d(line2Endpoints[0]),
    pointToCoords2d(line2Endpoints[1]),
  ] as const

  const center = getLineIntersection(line1, line2)
  if (!center) {
    return null
  }

  const targetAngle = normaliseConstraintAngleRadians(
    angleNumberToRadians(obj.kind.constraint.angle)
  )

  const directionPair = pickDirectionPair(center, line1, line2, targetAngle)
  if (!directionPair) {
    return null
  }

  const startDirection = directionPair.direction1
  const endDirection = directionPair.direction2

  const interval1 = getRayInterval(line1, center, startDirection)
  const interval2 = getRayInterval(line2, center, endDirection)
  const overlap = intersectIntervals(interval1, interval2)

  let radius = lerp(overlap.start, overlap.end, ANGLE_RADIUS_SAMPLE)
  if (radius < EPSILON) {
    radius = fallbackRadius(interval1, interval2)
  }
  if (radius < EPSILON) {
    return null
  }

  return {
    center,
    startDirection,
    endDirection,
    radius,
  }
}

function getLineIntersection(
  line1: LineSegment,
  line2: LineSegment
): Coords2d | null {
  const p = line1[0]
  const q = line2[0]
  const r = subVec(line1[1], line1[0])
  const s = subVec(line2[1], line2[0])

  const denominator = cross2d(r, s)
  if (Math.abs(denominator) < EPSILON) {
    return null
  }

  const qp = subVec(q, p)
  const t = cross2d(qp, s) / denominator
  return addVec(p, scaleVec(r, t))
}

function pickDirectionPair(
  center: Coords2d,
  line1: LineSegment,
  line2: LineSegment,
  targetAngle: number
) {
  const baseDirection1 = normalizeVec(subVec(line1[1], line1[0]))
  const baseDirection2 = normalizeVec(subVec(line2[1], line2[0]))
  if (
    lengthSq(baseDirection1) < EPSILON ||
    lengthSq(baseDirection2) < EPSILON
  ) {
    return null
  }

  const candidateDirections1 = [baseDirection1, scaleVec(baseDirection1, -1)]
  const candidateDirections2 = [baseDirection2, scaleVec(baseDirection2, -1)]

  let best: {
    direction1: Coords2d
    direction2: Coords2d
    angleScore: number
    overlapLength: number
    overlapEnd: number
  } | null = null

  for (const direction1 of candidateDirections1) {
    for (const direction2 of candidateDirections2) {
      const dot = clamp(dot2d(direction1, direction2), -1, 1)
      const angle = Math.acos(dot)
      const angleScore = Math.abs(angle - targetAngle)
      const interval1 = getRayInterval(line1, center, direction1)
      const interval2 = getRayInterval(line2, center, direction2)
      const overlap = intersectIntervals(interval1, interval2)
      const overlapLength = Math.max(0, overlap.end - overlap.start)
      const overlapEnd = overlap.end

      if (
        !best ||
        angleScore < best.angleScore - EPSILON ||
        (Math.abs(angleScore - best.angleScore) <= EPSILON &&
          (overlapLength > best.overlapLength + EPSILON ||
            (Math.abs(overlapLength - best.overlapLength) <= EPSILON &&
              overlapEnd > best.overlapEnd + EPSILON)))
      ) {
        best = {
          direction1: [...direction1],
          direction2: [...direction2],
          angleScore,
          overlapLength,
          overlapEnd,
        }
      }
    }
  }

  if (!best) {
    return null
  }

  return {
    direction1: best.direction1,
    direction2: best.direction2,
  }
}

function getRayInterval(
  line: LineSegment,
  center: Coords2d,
  direction: Coords2d
): RayInterval {
  const p1 = dot2d(subVec(line[0], center), direction)
  const p2 = dot2d(subVec(line[1], center), direction)
  const minProjection = Math.min(p1, p2)
  const maxProjection = Math.max(p1, p2)
  return {
    start: Math.max(0, minProjection),
    end: Math.max(0, maxProjection),
  }
}

function intersectIntervals(
  interval1: RayInterval,
  interval2: RayInterval
): RayInterval {
  const start = Math.max(interval1.start, interval2.start)
  const end = Math.min(interval1.end, interval2.end)
  if (end < start) {
    return { start, end: start }
  }
  return { start, end }
}

function fallbackRadius(interval1: RayInterval, interval2: RayInterval) {
  const availableEnds = [interval1.end, interval2.end].filter(
    (value) => value > EPSILON
  )
  if (availableEnds.length === 0) {
    return 0
  }
  return Math.min(...availableEnds) * ANGLE_RADIUS_SAMPLE
}

function angleNumberToRadians(angle: ApiNumber) {
  return angle.units === 'Rad' ? angle.value : (angle.value * Math.PI) / 180
}

function normaliseConstraintAngleRadians(angleRadians: number) {
  const fullTurn = Math.PI * 2
  let normalized = Math.abs(angleRadians) % fullTurn
  if (normalized > Math.PI) {
    normalized = fullTurn - normalized
  }
  return normalized
}
