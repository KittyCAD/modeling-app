import type {
  Number as ApiNumber,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  DISTANCE_CONSTRAINT_ARROW,
  DISTANCE_CONSTRAINT_BODY,
  DISTANCE_CONSTRAINT_HIT_AREA,
  DISTANCE_CONSTRAINT_LABEL,
} from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import { getResolvedTheme } from '@src/lib/theme'
import { getAngleDiff } from '@src/lib/utils'
import {
  clamp,
  dot2d,
  lengthSq,
  length2d,
  normalizeVec,
  subVec,
  TWO_PI,
} from '@src/lib/utils2d'
import {
  CONSTRAINT_COLOR,
  DIMENSION_HIDE_THRESHOLD_PX,
  DIMENSION_LABEL_GAP_PX,
  DIMENSION_LABEL_HIDE_THRESHOLD_PX,
  HIT_AREA_WIDTH_PX,
  updateLabel,
  updateLineHitArea,
} from '@src/machines/sketchSolve/constraints/DimensionLine'
import { Vector3 } from 'three'
import type { Group, Mesh } from 'three'
import type { Line2 } from 'three/examples/jsm/lines/Line2'
import {
  getLineIntersection,
  normalizeAngleRad,
} from '@src/machines/sketchSolve/constraints/AngleConstraintBuilder'
import { createArcPositions } from '@src/machines/sketchSolve/arcPositions'

const EPSILON = 1e-8
const GUIDE_EPSILON = 1e-6

export const ANGLE_CONSTRAINT_ARC_BODY_ROLE = 'angle-constraint-arc-body'
export const ANGLE_CONSTRAINT_GUIDE_BODY_ROLE = 'angle-constraint-guide-body'

export type LineSegment = readonly [Coords2d, Coords2d]

export type ArcDimensionLineRenderInput = {
  line1: LineSegment
  line2: LineSegment
  labelPosition: Coords2d
  angle: ApiNumber
}

export function updateArcDimensionLine(
  renderInput: ArcDimensionLineRenderInput,
  group: Group,
  obj: ApiObject,
  scale: number,
  sceneInfra: SceneInfra,
  angleValue: ApiNumber
) {
  const geometry = buildArcGeometry(renderInput)
  if (!geometry) {
    group.visible = false
    return
  }

  const { center, radius, startAngle, ccw, sweep, labelOffset } = geometry
  const arcLengthPx = (radius * sweep) / scale
  if (arcLengthPx < DIMENSION_HIDE_THRESHOLD_PX) {
    group.visible = false
    return
  }

  group.visible = true
  const showLabel = arcLengthPx >= DIMENSION_LABEL_HIDE_THRESHOLD_PX
  const labelCenter = new Vector3(
    renderInput.labelPosition[0],
    renderInput.labelPosition[1],
    0
  )

  const label = group.children.find(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
  )
  if (label) {
    label.position.copy(labelCenter)
  }

  for (const child of group.children) {
    const isLabelVisual =
      child.userData.type === DISTANCE_CONSTRAINT_LABEL ||
      child.userData.type === DISTANCE_CONSTRAINT_ARROW ||
      (child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA &&
        child.userData.subtype === DISTANCE_CONSTRAINT_LABEL)

    child.visible = isLabelVisual ? showLabel : true
  }

  const maxGapFromLabel = Math.max(
    0,
    Math.min(labelOffset, sweep - labelOffset) - 1e-4
  )
  const halfGapAngle = showLabel
    ? Math.min((DIMENSION_LABEL_GAP_PX * 0.5 * scale) / radius, maxGapFromLabel)
    : 0

  const section1StartOffset = 0
  const section1EndOffset = Math.max(0, labelOffset - halfGapAngle)
  const section2StartOffset = Math.min(sweep, labelOffset + halfGapAngle)
  const section2EndOffset = sweep
  const section1 = getArcSection(
    center,
    radius,
    startAngle,
    ccw,
    section1StartOffset,
    section1EndOffset
  )
  const section2 = getArcSection(
    center,
    radius,
    startAngle,
    ccw,
    section2StartOffset,
    section2EndOffset
  )
  if (!section1 || !section2) {
    group.visible = false
    return
  }

  const arcLines = getArcBodyLines(group)
  if (arcLines[0]) {
    arcLines[0].geometry.setPositions(section1.positions)
  }
  if (arcLines[1]) {
    arcLines[1].geometry.setPositions(section2.positions)
  }

  const startPoint = section1.startPoint
  const endPoint = section2.endPoint
  const startTangent = section1.startTangent
  const endTangent = section2.endTangent

  const arrows = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_ARROW
  ) as Mesh[]
  const arrow1 = arrows[0]
  const arrow2 = arrows[1]
  if (arrow1) {
    arrow1.position.copy(startPoint)
    arrow1.rotation.z = directionToArrowRotation(startTangent.clone().negate())
    arrow1.scale.setScalar(scale)
  }
  if (arrow2) {
    arrow2.position.copy(endPoint)
    arrow2.rotation.z = directionToArrowRotation(endTangent)
    arrow2.scale.setScalar(scale)
  }

  if (showLabel) {
    const theme = getResolvedTheme(sceneInfra.theme)
    const constraintColor = CONSTRAINT_COLOR[theme]
    updateLabel(group, obj, constraintColor, angleValue, scale)
  }

  const bodyHitAreas = group.children.filter(
    (child) =>
      child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA &&
      child.userData.subtype === DISTANCE_CONSTRAINT_BODY
  ) as Mesh[]
  if (bodyHitAreas[0]) {
    updateLineHitArea(
      bodyHitAreas[0],
      section1.startPoint,
      section1.endPoint,
      HIT_AREA_WIDTH_PX * scale
    )
  }
  if (bodyHitAreas[1]) {
    updateLineHitArea(
      bodyHitAreas[1],
      section2.startPoint,
      section2.endPoint,
      HIT_AREA_WIDTH_PX * scale
    )
  }

  const guideLines = getGuideBodyLines(group)
  updateGuideLine(guideLines[0], renderInput.line1, [
    startPoint.x,
    startPoint.y,
  ])
  updateGuideLine(guideLines[1], renderInput.line2, [endPoint.x, endPoint.y])
}

type ArcGeometry = {
  center: Coords2d
  radius: number
  startAngle: number
  ccw: boolean
  sweep: number
  labelOffset: number
}

type ArcCandidate = {
  startAngle: number
  ccw: boolean
  sweep: number
  labelOffset: number
  onArc: boolean
  centerBias: number
  sweepDelta: number
  overflow: number
}

function buildArcGeometry(
  renderInput: ArcDimensionLineRenderInput
): ArcGeometry | null {
  const center = getLineIntersection(renderInput.line1, renderInput.line2)
  if (!center) {
    return null
  }

  const radius = length2d(subVec(renderInput.labelPosition, center))
  if (radius <= EPSILON) {
    return null
  }

  const line1Direction = subVec(renderInput.line1[1], renderInput.line1[0])
  const line2Direction = subVec(renderInput.line2[1], renderInput.line2[0])
  if (
    lengthSq(line1Direction) < EPSILON ||
    lengthSq(line2Direction) < EPSILON
  ) {
    return null
  }

  const line1Unit = normalizeVec(line1Direction)
  const line2Unit = normalizeVec(line2Direction)
  const line1Candidates: Coords2d[] = [
    line1Unit,
    [-line1Unit[0], -line1Unit[1]],
  ]
  const line2Candidates: Coords2d[] = [
    line2Unit,
    [-line2Unit[0], -line2Unit[1]],
  ]

  const labelAngle = Math.atan2(
    renderInput.labelPosition[1] - center[1],
    renderInput.labelPosition[0] - center[0]
  )
  const targetSweep = normalizeAngleRad(renderInput.angle)
  if (targetSweep < EPSILON || targetSweep > TWO_PI - EPSILON) {
    return null
  }

  const best = chooseArcCandidate({
    line1Candidates,
    line2Candidates,
    labelAngle,
    targetSweep,
  })
  if (!best) {
    return null
  }

  return {
    center,
    radius,
    startAngle: best.startAngle,
    ccw: best.ccw,
    sweep: best.sweep,
    labelOffset: clamp(best.labelOffset, 0, best.sweep),
  }
}

function chooseArcCandidate(args: {
  line1Candidates: Coords2d[]
  line2Candidates: Coords2d[]
  labelAngle: number
  targetSweep: number
}): ArcCandidate | null {
  let best: ArcCandidate | null = null

  for (const startDirection of args.line1Candidates) {
    for (const endDirection of args.line2Candidates) {
      const startAngle = Math.atan2(startDirection[1], startDirection[0])
      const endAngle = Math.atan2(endDirection[1], endDirection[0])

      for (const ccw of [true, false]) {
        const candidate = buildArcCandidate(
          startAngle,
          endAngle,
          ccw,
          args.labelAngle,
          args.targetSweep
        )
        if (!candidate) {
          continue
        }
        if (!best || isBetterArcCandidate(candidate, best)) {
          best = candidate
        }
      }
    }
  }

  return best
}

function buildArcCandidate(
  startAngle: number,
  endAngle: number,
  ccw: boolean,
  labelAngle: number,
  targetSweep: number
): ArcCandidate | null {
  const sweep = getAngleDiff(startAngle, endAngle, ccw)
  if (sweep < EPSILON) {
    return null
  }

  const labelOffset = getAngleDiff(startAngle, labelAngle, ccw)
  return {
    startAngle,
    ccw,
    sweep,
    labelOffset,
    onArc: labelOffset <= sweep + 1e-6,
    centerBias: Math.abs(labelOffset - sweep * 0.5),
    sweepDelta: Math.abs(sweep - targetSweep),
    overflow: Math.max(0, labelOffset - sweep),
  }
}

function isBetterArcCandidate(a: ArcCandidate, b: ArcCandidate) {
  if (a.onArc !== b.onArc) {
    return a.onArc
  }
  if (a.sweepDelta !== b.sweepDelta) {
    return a.sweepDelta < b.sweepDelta
  }
  if (a.centerBias !== b.centerBias) {
    return a.centerBias < b.centerBias
  }
  return a.overflow < b.overflow
}

function getArcBodyLines(group: Group): Line2[] {
  const roleMatched = group.children.filter(
    (child) =>
      child.userData.type === DISTANCE_CONSTRAINT_BODY &&
      child.userData.role === ANGLE_CONSTRAINT_ARC_BODY_ROLE
  ) as Line2[]
  if (roleMatched.length >= 2) {
    return roleMatched
  }

  return group.children.filter(
    (child) =>
      child.userData.type === DISTANCE_CONSTRAINT_BODY &&
      child.userData.role !== ANGLE_CONSTRAINT_GUIDE_BODY_ROLE
  ) as Line2[]
}

function getGuideBodyLines(group: Group): Line2[] {
  return group.children.filter(
    (child) =>
      child.userData.type === DISTANCE_CONSTRAINT_BODY &&
      child.userData.role === ANGLE_CONSTRAINT_GUIDE_BODY_ROLE
  ) as Line2[]
}

function updateGuideLine(
  line: Line2 | undefined,
  segment: LineSegment,
  arcEndpoint: Coords2d
) {
  if (!line) {
    return
  }

  const guideSegment = getGuideSegment(segment, arcEndpoint)
  if (!guideSegment) {
    line.visible = false
    return
  }

  line.visible = true
  line.geometry.setPositions([
    guideSegment[0][0],
    guideSegment[0][1],
    0,
    guideSegment[1][0],
    guideSegment[1][1],
    0,
  ])
}

function getGuideSegment(
  segment: LineSegment,
  arcEndpoint: Coords2d
): LineSegment | null {
  const segmentDirection = subVec(segment[1], segment[0])
  const segmentDirectionLengthSq = lengthSq(segmentDirection)
  if (segmentDirectionLengthSq < EPSILON) {
    return null
  }

  const t =
    dot2d(subVec(arcEndpoint, segment[0]), segmentDirection) /
    segmentDirectionLengthSq
  if (t >= -GUIDE_EPSILON && t <= 1 + GUIDE_EPSILON) {
    return null
  }

  const segmentEdgePoint = t < 0 ? segment[0] : segment[1]
  return [segmentEdgePoint, arcEndpoint]
}

type ArcSection = {
  positions: number[]
  startPoint: Vector3
  endPoint: Vector3
  startTangent: Vector3
  endTangent: Vector3
}

function getArcSection(
  center: Coords2d,
  radius: number,
  startAngle: number,
  ccw: boolean,
  startOffset: number,
  endOffset: number
): ArcSection | null {
  const clampedStart = Math.max(0, startOffset)
  const clampedEnd = Math.max(clampedStart, endOffset)
  const sectionStartAngle = angleAtOffset(startAngle, ccw, clampedStart)
  const sectionEndAngle = angleAtOffset(startAngle, ccw, clampedEnd)
  const positions = createArcPositions({
    center,
    radius,
    startAngle: sectionStartAngle,
    endAngle: sectionEndAngle,
    ccw,
  })
  const pointCount = positions.length / 3
  if (pointCount < 2) {
    return null
  }

  const startPoint = pointFromPositions(positions, 0)
  const endPoint = pointFromPositions(positions, pointCount - 1)
  const fallbackStartTangent = tangentForAngle(sectionStartAngle, ccw)
  const fallbackEndTangent = tangentForAngle(sectionEndAngle, ccw)

  return {
    positions,
    startPoint,
    endPoint,
    startTangent: tangentFromPositions(positions, 0, 1) ?? fallbackStartTangent,
    endTangent:
      tangentFromPositions(positions, pointCount - 2, pointCount - 1) ??
      fallbackEndTangent,
  }
}

function angleAtOffset(startAngle: number, ccw: boolean, offset: number) {
  return startAngle + (ccw ? offset : -offset)
}

function pointFromPositions(positions: number[], index: number) {
  const i = index * 3
  return new Vector3(positions[i], positions[i + 1], positions[i + 2])
}

function tangentFromPositions(
  positions: number[],
  fromIndex: number,
  toIndex: number
): Vector3 | null {
  const from = pointFromPositions(positions, fromIndex)
  const to = pointFromPositions(positions, toIndex)
  const tangent = to.sub(from)
  if (tangent.lengthSq() < EPSILON) {
    return null
  }
  return tangent.normalize()
}

function tangentForAngle(angle: number, ccw: boolean) {
  return ccw
    ? new Vector3(-Math.sin(angle), Math.cos(angle), 0)
    : new Vector3(Math.sin(angle), -Math.cos(angle), 0)
}

function directionToArrowRotation(direction: Vector3) {
  return Math.atan2(direction.y, direction.x) - Math.PI / 2
}
