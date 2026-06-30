import type {
  Number as ApiNumber,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { DISTANCE_CONSTRAINT_BODY } from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import {
  addVec,
  distance2d,
  dot2d,
  getCcwSweep,
  getLineIntersection,
  getPolarAngle2d,
  intersectRanges,
  lerp,
  normalizeAngle,
  normalizeVec,
  rotateVec2d,
  scaleVec,
  subVec,
} from '@src/lib/utils2d'
import {
  ANGLE_CONSTRAINT_ARC_BODY_ROLE,
  ANGLE_CONSTRAINT_GUIDE_BODY_ROLE,
  type ArcLineInfo,
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
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'

const OVERLAP_EPSILON = 1e-8
export const MIN_NON_OVERLAP_ANGLE_CONSTRAINT_RADIUS_PX = 20

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
    const renderInput = calculateArcRenderInput(obj, objects, scale)
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

export function calculateArcRenderInput(
  obj: ApiObject,
  objects: ApiObject[],
  scale: number
): ArcLineInfo | null {
  if (!isAngleConstraint(obj)) {
    return null
  }

  const [lineId1, lineId2] = obj.kind.constraint.lines
  const line1 = getLinePoints(objects[lineId1], objects)
  const line2 = getLinePoints(objects[lineId2], objects)
  if (!line1 || !line2) {
    return null
  }

  const center = getLineIntersection(line1, line2)
  if (!center) {
    return null
  }

  const line1Dir = normalizeVec(subVec(line1[1], line1[0]))
  const line2Dir = normalizeVec(subVec(line2[1], line2[0]))
  const explicitRenderInput = calculateExplicitArcRenderInput(
    obj,
    line1,
    line2,
    line1Dir,
    line2Dir,
    center,
    scale
  )
  if (explicitRenderInput) {
    return explicitRenderInput
  }

  // The distances of the line segment end points from the intersection (center)
  const line1SignedDistances = [
    dot2d(subVec(line1[0], center), line1Dir),
    dot2d(subVec(line1[1], center), line1Dir),
  ] as Coords2d
  const line2SignedDistances = [
    dot2d(subVec(line2[0], center), line2Dir),
    dot2d(subVec(line2[1], center), line2Dir),
  ] as Coords2d

  const commonLineRange = intersectRanges(
    line1SignedDistances,
    line2SignedDistances
  )
  const radiusSigned = commonLineRange
    ? findShortestRadiusFromRange(commonLineRange)
    : // No intersection, take the second smallest distance,
      // we could take the third, or the mid point between them..
      [...line1SignedDistances, ...line2SignedDistances].sort(
        (a, b) => a - b
      )[1]
  const shouldApplyNonOverlapFallback =
    !commonLineRange ||
    Math.abs(commonLineRange[1] - commonLineRange[0]) < OVERLAP_EPSILON
  const adjustedRadiusSigned = shouldApplyNonOverlapFallback
    ? withMinimumMagnitude(
        radiusSigned,
        MIN_NON_OVERLAP_ANGLE_CONSTRAINT_RADIUS_PX * scale
      )
    : radiusSigned

  const signedAngle = normalizeAngleRad(obj.kind.constraint.angle)

  const explicitLabelPosition = getAngleLabelPosition(obj)
  const defaultRadius = Math.abs(adjustedRadiusSigned)
  const radius = getAngleArcRadius(explicitLabelPosition, center, defaultRadius)
  const startVector = scaleVec(normalizeVec(line1Dir), adjustedRadiusSigned)
  const startAngle = Math.atan2(startVector[1], startVector[0])
  const defaultLabelPosition = addVec(
    center,
    rotateVec2d(startVector, signedAngle / 2)
  )
  const labelPosition = explicitLabelPosition ?? defaultLabelPosition

  return {
    line1,
    line2,
    labelPosition,
    labelAngle: getAngleLabelAngle(explicitLabelPosition, center),
    center,
    radius,
    startAngle,
    sweepAngle: signedAngle,
  }
}

export function normalizeAngleRad(angle: ApiNumber) {
  const angleRadians =
    angle.units === 'Rad' ? angle.value : (angle.value * Math.PI) / 180
  return normalizeAngle(angleRadians)
}

// Major angles are ones > 180deg
export function isMajorConstraintAngle(angle: ApiNumber) {
  return normalizeAngleRad(angle) > Math.PI
}

function calculateExplicitArcRenderInput(
  obj: AngleConstraint,
  line1: LineSegment,
  line2: LineSegment,
  line1Dir: Coords2d,
  line2Dir: Coords2d,
  center: Coords2d,
  scale: number
): ArcLineInfo | null {
  const sector = explicitAngleSector(obj.kind.constraint.sector)
  if (!sector) {
    return null
  }

  const sectorBoundaries = angleSectorBoundaries(
    sector,
    line1,
    line2,
    line1Dir,
    line2Dir
  )
  const [start, end] =
    obj.kind.constraint.inverse === true
      ? [sectorBoundaries[1], sectorBoundaries[0]]
      : sectorBoundaries
  const explicitLabelPosition = getAngleLabelPosition(obj)
  const defaultRadius = calculateExplicitArcRadius(
    start.line,
    end.line,
    start.dir,
    end.dir,
    center,
    scale
  )
  const radius = getAngleArcRadius(explicitLabelPosition, center, defaultRadius)
  const startVector = scaleVec(start.dir, radius)
  const startAngle = Math.atan2(startVector[1], startVector[0])
  const sweepAngle = getCcwSweep(start.dir, end.dir)
  const defaultLabelPosition = addVec(
    center,
    rotateVec2d(startVector, sweepAngle / 2)
  )
  const labelPosition = explicitLabelPosition ?? defaultLabelPosition

  return {
    line1: start.line,
    line2: end.line,
    labelPosition,
    labelAngle: getAngleLabelAngle(explicitLabelPosition, center),
    center,
    radius,
    startAngle,
    sweepAngle,
  }
}

function getAngleLabelPosition(obj: AngleConstraint): Coords2d | null {
  const labelPosition = obj.kind.constraint.labelPosition
  return labelPosition ? [labelPosition.x.value, labelPosition.y.value] : null
}

function getAngleArcRadius(
  labelPosition: Coords2d | null,
  center: Coords2d,
  fallbackRadius: number
) {
  if (!labelPosition) {
    return fallbackRadius
  }

  const labelRadius = distance2d(labelPosition, center)
  return labelRadius > OVERLAP_EPSILON ? labelRadius : fallbackRadius
}

function getAngleLabelAngle(labelPosition: Coords2d | null, center: Coords2d) {
  return labelPosition ? getPolarAngle2d(center, labelPosition) : undefined
}

function explicitAngleSector(sector: unknown) {
  return sector === 1 || sector === 2 || sector === 3 || sector === 4
    ? sector
    : null
}

function angleSectorBoundaries(
  sector: 1 | 2 | 3 | 4,
  line1: LineSegment,
  line2: LineSegment,
  line1Dir: Coords2d,
  line2Dir: Coords2d
) {
  switch (sector) {
    case 1:
      return [
        { line: line1, dir: line1Dir },
        { line: line2, dir: line2Dir },
      ] as const
    case 2:
      return [
        { line: line2, dir: line2Dir },
        { line: line1, dir: scaleVec(line1Dir, -1) },
      ] as const
    case 3:
      return [
        { line: line1, dir: scaleVec(line1Dir, -1) },
        { line: line2, dir: scaleVec(line2Dir, -1) },
      ] as const
    case 4:
      return [
        { line: line2, dir: scaleVec(line2Dir, -1) },
        { line: line1, dir: line1Dir },
      ] as const
  }
}

function calculateExplicitArcRadius(
  line1: LineSegment,
  line2: LineSegment,
  line1Dir: Coords2d,
  line2Dir: Coords2d,
  center: Coords2d,
  scale: number
) {
  const line1Range = projectionRange(line1, center, line1Dir)
  const line2Range = projectionRange(line2, center, line2Dir)
  const commonLineRange = intersectRanges(line1Range, line2Range)
  const commonRayRange = commonLineRange
    ? intersectRanges(commonLineRange, [0, Number.POSITIVE_INFINITY])
    : null
  const radius = commonRayRange
    ? findShortestRadiusFromRange(commonRayRange)
    : findFallbackRayRadius([line1Range, line2Range])
  const shouldApplyNonOverlapFallback =
    !commonRayRange ||
    Math.abs(commonRayRange[1] - commonRayRange[0]) < OVERLAP_EPSILON
  return shouldApplyNonOverlapFallback
    ? withMinimumMagnitude(
        radius,
        MIN_NON_OVERLAP_ANGLE_CONSTRAINT_RADIUS_PX * scale
      )
    : radius
}

function projectionRange(
  line: LineSegment,
  center: Coords2d,
  direction: Coords2d
): [number, number] {
  const distances = [
    dot2d(subVec(line[0], center), direction),
    dot2d(subVec(line[1], center), direction),
  ]
  return [Math.min(...distances), Math.max(...distances)]
}

function findFallbackRayRadius(ranges: [number, number][]) {
  return (
    ranges
      .flat()
      .filter((distance) => distance > OVERLAP_EPSILON)
      .sort((a, b) => a - b)[1] ?? 0
  )
}

// finds the shortest radius on the range of projected distances of the 2 lines.
function findShortestRadiusFromRange(range: [number, number]) {
  // Try the point at 15% and 85% of the interval, see which one is closer to center.
  // Note that range has signed values (can be negative).
  const r1 = lerp(range[0], range[1], 0.15)
  const r2 = lerp(range[0], range[1], 0.85)
  return Math.abs(r1) < Math.abs(r2) ? r1 : r2
}

function withMinimumMagnitude(value: number, minMagnitude: number) {
  if (value === 0) {
    return minMagnitude
  }
  return Math.sign(value) * Math.max(Math.abs(value), minMagnitude)
}
