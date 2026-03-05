import type {
  Number as ApiNumber,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { DISTANCE_CONSTRAINT_BODY } from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import {
  intersectRanges,
  lerp,
  normalizeVec,
  subVec,
  scaleVec,
  rotateVec2d,
  addVec,
  dot2d,
  TWO_PI,
} from '@src/lib/utils2d'
import {
  ANGLE_CONSTRAINT_ARC_BODY_ROLE,
  ANGLE_CONSTRAINT_GUIDE_BODY_ROLE,
  type ArcDimensionLineRenderInput,
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

  const angle = obj.kind.constraint.angle
  const labelPosition = getDefaultAngleLabelPosition(line1, line2, angle)
  if (!labelPosition) {
    return null
  }

  return {
    line1,
    line2,
    labelPosition,
    angle,
  }
}

export function normalizeAngleRad(angle: ApiNumber) {
  const angleRadians =
    angle.units === 'Rad' ? angle.value : (angle.value * Math.PI) / 180
  const normalized = ((angleRadians % TWO_PI) + TWO_PI) % TWO_PI
  return normalized
}

// Major angles are ones > 180deg
export function isMajorConstraintAngle(angle: ApiNumber) {
  return normalizeAngleRad(angle) > Math.PI
}

function getDefaultAngleLabelPosition(
  line1: LineSegment,
  line2: LineSegment,
  angle: ApiNumber
): Coords2d | null {
  const center = getLineIntersection(line1, line2)
  if (!center) {
    return null
  }

  const isMajorAngle = isMajorConstraintAngle(angle)

  // The distances of the line segment end points from the intersection center
  const line1Dir = normalizeVec(subVec(line1[1], line1[0]))
  const line2Dir = normalizeVec(subVec(line2[1], line2[0]))
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
  const radius = commonLineRange
    ? lerp(commonLineRange[0], commonLineRange[1], isMajorAngle ? 0.9 : 0.5)
    : // No intersection, take the second smallest distance,
      // we could take the third, or the mid point between them..
      [...line1SignedDistances, ...line2SignedDistances].sort(
        (a, b) => a - b
      )[1]

  //const signedAngle = getSignedAngleBetweenVec(line1Dir, line2Dir)
  const signedAngle = normalizeAngleRad(angle)

  let result = scaleVec(normalizeVec(line1Dir), radius)
  console.log(signedAngle)
  result = rotateVec2d(result, signedAngle / 2)
  result = addVec(center, result)

  return result
}


// Returns the intersection of 2 infinite lines that lie on the given line segments.
// Returns a valid point even if the line segments themselves don't intersect.
// Returns null if the lines are parallel,
export function getLineIntersection(
  line1: LineSegment,
  line2: LineSegment
): Coords2d | null {
  const p = line1[0]
  const q = line2[0]
  const r = subVec(line1[1], line1[0])
  const s = subVec(line2[1], line2[0])
  const denominator = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(denominator) < 1e-8) {
    return null
  }

  const qp = subVec(q, p)
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denominator
  return [p[0] + r[0] * t, p[1] + r[1] * t]
}