import type {
  Number as ApiNumber,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { DISTANCE_CONSTRAINT_BODY } from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import {
  clamp,
  intersectRanges,
  getSignedAngleBetweenVec,
  length2d,
  lerp,
  normalizeVec,
  lengthSq,
  subVec,
  distance2d,
  scaleVec,
  rotateVec2d,
} from '@src/lib/utils2d'
import {
  ANGLE_CONSTRAINT_ARC_BODY_ROLE,
  ANGLE_CONSTRAINT_GUIDE_BODY_ROLE,
  type ArcDimensionLineRenderInput,
  getLineIntersection,
  type LineSegment,
  updateArcDimensionLine,
} from '@src/machines/sketchSolve/constraints/ArcDimensionLine'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import { createDimensionLine } from '@src/machines/sketchSolve/constraints/DimensionLine'
import {
  type AngleConstraint,
  getLinePoints,
  isAngleConstraint,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { Group } from 'three'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import { Line2 } from 'three/examples/jsm/lines/Line2'

const TWO_PI = Math.PI * 2
const EPSILON = 1e-8
const RADIUS_SAMPLE = 0.2
const MAJOR_LABEL_MAX_DISTANCE = 40

export class AngleConstraintBuilder {
  private readonly resources: ConstraintResources

  constructor(resources: ConstraintResources) {
    this.resources = resources
  }

  public init(obj: AngleConstraint) {
    const group = createDimensionLine(obj, this.resources)
    initializeAngleConstraintLines(group, this.resources)
    return group
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
    const renderInput = calculateArcRenderInput(obj, objects)
    if (!renderInput) {
      group.visible = false
      return
    }

    this.resources.updateConstraintGroup(group, obj.id, selectedIds, hoveredId)
    updateArcDimensionLine(
      renderInput,
      group,
      obj,
      scale,
      sceneInfra,
      obj.kind.constraint.angle
    )
  }
}

function initializeAngleConstraintLines(
  group: Group,
  resources: ConstraintResources
) {
  const bodyLines = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_BODY
  ) as Line2[]

  for (const line of bodyLines) {
    line.userData.role = ANGLE_CONSTRAINT_ARC_BODY_ROLE
  }

  for (let index = 0; index < 2; index++) {
    const guideGeometry = new LineGeometry()
    guideGeometry.setPositions([0, 0, 0, 0, 0, 0])

    const guideLine = new Line2(guideGeometry, resources.materials.default.line)
    guideLine.userData.type = DISTANCE_CONSTRAINT_BODY
    guideLine.userData.role = ANGLE_CONSTRAINT_GUIDE_BODY_ROLE
    guideLine.visible = false
    group.add(guideLine)
  }
}

function calculateArcRenderInput(
  obj: ApiObject,
  objects: ApiObject[]
): ArcDimensionLineRenderInput | null {
  if (!isAngleConstraint(obj)) {
    return null
  }

  const [lineId1, lineId2] = obj.kind.constraint.lines
  const line1 = getLinePoints(objects[lineId1], objects)
  const line2 = getLinePoints(objects[lineId2], objects)
  if (!line1 || !line2) {
    return null
  }

  const isMajorAngle = isMajorConstraintAngle(obj.kind.constraint.angle)
  const labelPosition = getDefaultAngleLabelPosition(line1, line2, isMajorAngle)
  if (!labelPosition) {
    return null
  }

  return {
    line1,
    line2,
    labelPosition,
    isMajorAngle,
  }
}

function isMajorConstraintAngle(angle: ApiNumber) {
  const angleRadians =
    angle.units === 'Rad' ? angle.value : (angle.value * Math.PI) / 180
  const normalized = ((angleRadians % TWO_PI) + TWO_PI) % TWO_PI
  return normalized > Math.PI + EPSILON
}

function getDefaultAngleLabelPosition(
  line1: LineSegment,
  line2: LineSegment,
  isMajorAngle: boolean
): Coords2d | null {
  const center = getLineIntersection(line1, line2)
  if (!center) {
    return null
  }

  const minorBisectorAngle = getMinorBisectorAngle(line1, line2, center)
  if (minorBisectorAngle === null) {
    return null
  }

  if (isMajorAngle) {
    const majorBisectorAngle = minorBisectorAngle + Math.PI
    const majorRadius = getMajorLabelRadius(
      line1,
      line2,
      center,
      majorBisectorAngle
    )
    if (majorRadius < EPSILON) {
      return null
    }
    return pointOnCircle(center, majorRadius, majorBisectorAngle)
  } else {
    // The distances of the line segment end points from the intersection center
    const line1Distances = [
      distance2d(center, line1[0]),
      distance2d(center, line1[1]),
    ] as Coords2d
    const line2Distances = [
      distance2d(center, line2[0]),
      distance2d(center, line2[1]),
    ] as Coords2d

    const commonLineRange = intersectRanges(line1Distances, line2Distances)
    const radius = commonLineRange
      ? lerp(commonLineRange[0], commonLineRange[1], 0.5)
      : // No intersection, take the second smallest distance,
        // we could take the third, or the mid point between them..
        [...line1Distances, ...line2Distances].sort((a, b) => a - b)[1]

    const line1Dir = subVec(line1[1], line1[0])
    const line2Dir = subVec(line2[1], line2[0])
    const signedAngle = getSignedAngleBetweenVec(line1Dir, line2Dir)

    let result = scaleVec(normalizeVec(line1Dir), radius)
    result = rotateVec2d(result, signedAngle / 2)

    return result
  }

  // const minorRadius = getMinorRadiusFromEndpointDistanceRanges(line1, line2, center)
  // if (minorRadius < EPSILON) {
  //   return null
  // }

  // return pointOnCircle(center, minorRadius, minorBisectorAngle)
}

function getMinorBisectorAngle(
  line1: LineSegment,
  line2: LineSegment,
  center: Coords2d
) {
  const direction1 = getDirectionTowardSegment(line1, center)
  const direction2 = getDirectionTowardSegment(line2, center)
  if (!direction1 || !direction2) {
    return null
  }
  return getBisectorAngle(direction1, direction2)
}

function getDirectionTowardSegment(
  line: LineSegment,
  center: Coords2d
): Coords2d | null {
  const midpoint: Coords2d = [
    (line[0][0] + line[1][0]) * 0.5,
    (line[0][1] + line[1][1]) * 0.5,
  ]
  const towardMid = normalizeVec(subVec(midpoint, center))
  if (lengthSq(towardMid) >= EPSILON) {
    return towardMid
  }

  const towardStart = normalizeVec(subVec(line[0], center))
  if (lengthSq(towardStart) >= EPSILON) {
    return towardStart
  }

  const towardEnd = normalizeVec(subVec(line[1], center))
  if (lengthSq(towardEnd) >= EPSILON) {
    return towardEnd
  }

  return null
}

function getMajorLabelRadius(
  line1: LineSegment,
  line2: LineSegment,
  center: Coords2d,
  majorBisectorAngle: number
) {
  const majorRay1 = chooseLineRayTowardAngle(line1, majorBisectorAngle)
  const majorRay2 = chooseLineRayTowardAngle(line2, majorBisectorAngle)
  if (!majorRay1 && !majorRay2) {
    return MAJOR_LABEL_MAX_DISTANCE
  }

  const interval1 = majorRay1
    ? rayIntervalWithinSegment(line1, center, majorRay1)
    : null
  const interval2 = majorRay2
    ? rayIntervalWithinSegment(line2, center, majorRay2)
    : null
  const radius = radiusFromIntervals(
    interval1,
    interval2,
    MAJOR_LABEL_MAX_DISTANCE
  )
  return Math.min(radius, MAJOR_LABEL_MAX_DISTANCE)
}

function chooseLineRayTowardAngle(
  line: LineSegment,
  targetAngle: number
): Coords2d | null {
  const baseDirection = normalizeVec(subVec(line[1], line[0]))
  if (lengthSq(baseDirection) < EPSILON) {
    return null
  }

  const oppositeDirection: Coords2d = [-baseDirection[0], -baseDirection[1]]
  const baseAngle = Math.atan2(baseDirection[1], baseDirection[0])
  const oppositeAngle = Math.atan2(oppositeDirection[1], oppositeDirection[0])

  return absoluteAngleDifference(baseAngle, targetAngle) <=
    absoluteAngleDifference(oppositeAngle, targetAngle)
    ? baseDirection
    : oppositeDirection
}

function absoluteAngleDifference(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

function getMinorRadiusFromEndpointDistanceRanges(
  line1: LineSegment,
  line2: LineSegment,
  center: Coords2d
) {
  const range1 = getEndpointDistanceRange(line1, center)
  const range2 = getEndpointDistanceRange(line2, center)
  const overlapStart = Math.max(range1.start, range2.start)
  const overlapEnd = Math.min(range1.end, range2.end)
  if (overlapEnd >= overlapStart) {
    return lerp(overlapStart, overlapEnd, RADIUS_SAMPLE)
  }

  if (range1.end < range2.start) {
    return (range1.end + range2.start) * 0.5
  }

  return (range2.end + range1.start) * 0.5
}

function getBisectorAngle(direction1: Coords2d, direction2: Coords2d) {
  const signed = getSignedAngleBetweenVec(direction1, direction2)
  const startAngle = Math.atan2(direction1[1], direction1[0])
  return startAngle + signed * 0.5
}

function pointOnCircle(
  center: Coords2d,
  radius: number,
  angle: number
): Coords2d {
  return [
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
  ]
}

type DistanceRange = {
  start: number
  end: number
}

function getEndpointDistanceRange(line: LineSegment, center: Coords2d) {
  const d1 = length2d(subVec(line[0], center))
  const d2 = length2d(subVec(line[1], center))
  return {
    start: Math.min(d1, d2),
    end: Math.max(d1, d2),
  }
}

function rayIntervalWithinSegment(
  line: LineSegment,
  center: Coords2d,
  rayDirection: Coords2d
) {
  const p1 =
    (line[0][0] - center[0]) * rayDirection[0] +
    (line[0][1] - center[1]) * rayDirection[1]
  const p2 =
    (line[1][0] - center[0]) * rayDirection[0] +
    (line[1][1] - center[1]) * rayDirection[1]
  const low = Math.min(p1, p2)
  const high = Math.max(p1, p2)
  if (high < EPSILON) {
    return null
  }
  return {
    start: Math.max(0, low),
    end: Math.max(0, high),
  }
}

function radiusFromIntervals(
  interval1: DistanceRange | null,
  interval2: DistanceRange | null,
  fallbackValue: number
) {
  if (!interval1 && !interval2) {
    return fallbackValue
  }
  if (interval1 && !interval2) {
    return lerp(interval1.start, interval1.end, RADIUS_SAMPLE)
  }
  if (!interval1 && interval2) {
    return lerp(interval2.start, interval2.end, RADIUS_SAMPLE)
  }

  const one = interval1 as DistanceRange
  const two = interval2 as DistanceRange
  const overlapStart = Math.max(one.start, two.start)
  const overlapEnd = Math.min(one.end, two.end)
  if (overlapEnd >= overlapStart) {
    return lerp(overlapStart, overlapEnd, RADIUS_SAMPLE)
  }

  const target =
    one.end < two.start
      ? (one.end + two.start) * 0.5
      : (two.end + one.start) * 0.5
  const candidate1 = clamp(target, one.start, one.end)
  const candidate2 = clamp(target, two.start, two.end)
  return Math.abs(candidate1 - target) <= Math.abs(candidate2 - target)
    ? candidate1
    : candidate2
}
