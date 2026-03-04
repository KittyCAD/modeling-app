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
  getSignedAngleBetweenVec,
  lengthSq,
  length2d,
  normalizeVec,
  subVec,
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

const TWO_PI = Math.PI * 2
const EPSILON = 1e-8
const GUIDE_EPSILON = 1e-6

export const ANGLE_CONSTRAINT_ARC_BODY_ROLE = 'angle-constraint-arc-body'
export const ANGLE_CONSTRAINT_GUIDE_BODY_ROLE = 'angle-constraint-guide-body'

export type LineSegment = readonly [Coords2d, Coords2d]

export type ArcDimensionLineRenderInput = {
  line1: LineSegment
  line2: LineSegment
  labelPosition: Coords2d
  isMajorAngle: boolean
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

  const { center, radius, startAngle, directionSign, sweep, labelOffset } =
    geometry
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

  const arcLines = getArcBodyLines(group)
  if (arcLines[0]) {
    setArcLinePositions(
      arcLines[0],
      center,
      radius,
      startAngle,
      directionSign,
      section1StartOffset,
      section1EndOffset
    )
  }
  if (arcLines[1]) {
    setArcLinePositions(
      arcLines[1],
      center,
      radius,
      startAngle,
      directionSign,
      section2StartOffset,
      section2EndOffset
    )
  }

  const startPoint = pointOnArc(center, radius, startAngle, directionSign, 0)
  const endPoint = pointOnArc(center, radius, startAngle, directionSign, sweep)
  const startTangent = tangentForArc(startAngle, directionSign)
  const endTangent = tangentForArc(
    startAngle + directionSign * sweep,
    directionSign
  )

  const arrows = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_ARROW
  ) as Mesh[]
  const arrow1 = arrows[0]
  const arrow2 = arrows[1]
  if (arrow1) {
    arrow1.position.copy(startPoint)
    arrow1.rotation.z = directionToArrowRotation(
      startTangent.multiplyScalar(-1)
    )
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
      pointOnArc(
        center,
        radius,
        startAngle,
        directionSign,
        section1StartOffset
      ),
      pointOnArc(center, radius, startAngle, directionSign, section1EndOffset),
      HIT_AREA_WIDTH_PX * scale
    )
  }
  if (bodyHitAreas[1]) {
    updateLineHitArea(
      bodyHitAreas[1],
      pointOnArc(
        center,
        radius,
        startAngle,
        directionSign,
        section2StartOffset
      ),
      pointOnArc(center, radius, startAngle, directionSign, section2EndOffset),
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
  if (Math.abs(denominator) < EPSILON) {
    return null
  }

  const qp = subVec(q, p)
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denominator
  return [p[0] + r[0] * t, p[1] + r[1] * t]
}

function buildArcGeometry(renderInput: ArcDimensionLineRenderInput) {
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

  const best = chooseArcCandidate({
    line1: renderInput.line1,
    line2: renderInput.line2,
    center,
    line1Candidates,
    line2Candidates,
    labelAngle,
    isMajorAngle: renderInput.isMajorAngle,
  })
  if (!best) {
    return null
  }

  return {
    center,
    radius,
    startAngle: best.startAngle,
    directionSign: best.directionSign,
    sweep: best.sweep,
    labelOffset: clamp(best.labelOffset, 0, best.sweep),
  }
}

type ArcCandidate = {
  startAngle: number
  directionSign: number
  sweep: number
  labelOffset: number
  overflow: number
  onArc: boolean
  reachCount: number
  overlapLength: number
}

function chooseArcCandidate(args: {
  line1: LineSegment
  line2: LineSegment
  center: Coords2d
  line1Candidates: Coords2d[]
  line2Candidates: Coords2d[]
  labelAngle: number
  isMajorAngle: boolean
}) {
  const candidates: ArcCandidate[] = []

  for (const startDirection of args.line1Candidates) {
    for (const endDirection of args.line2Candidates) {
      const signed = getSignedAngleBetweenVec(startDirection, endDirection)
      const minorSweep = Math.abs(signed)
      if (minorSweep < 1e-4) {
        continue
      }

      const minorDirectionSign = signed >= 0 ? 1 : -1
      const sweep = args.isMajorAngle ? TWO_PI - minorSweep : minorSweep
      const directionSign = args.isMajorAngle
        ? -minorDirectionSign
        : minorDirectionSign
      if (sweep < 1e-4) {
        continue
      }

      const startAngle = Math.atan2(startDirection[1], startDirection[0])
      const labelOffset = getOffsetAlongArc(
        startAngle,
        args.labelAngle,
        directionSign
      )
      const overflow = Math.max(0, labelOffset - sweep)
      const onArc = labelOffset <= sweep + 1e-6

      const interval1 = rayIntervalWithinSegment(
        args.line1,
        args.center,
        startDirection
      )
      const interval2 = rayIntervalWithinSegment(
        args.line2,
        args.center,
        endDirection
      )
      const reachCount = Number(Boolean(interval1)) + Number(Boolean(interval2))
      const overlapLength =
        interval1 && interval2
          ? Math.max(
              0,
              Math.min(interval1.end, interval2.end) -
                Math.max(interval1.start, interval2.start)
            )
          : -1

      candidates.push({
        startAngle,
        directionSign,
        sweep,
        labelOffset,
        overflow,
        onArc,
        reachCount,
        overlapLength,
      })
    }
  }

  if (candidates.length === 0) {
    return null
  }

  const rankedCandidates = candidates.some((candidate) => candidate.onArc)
    ? candidates.filter((candidate) => candidate.onArc)
    : candidates

  rankedCandidates.sort((a, b) => {
    const centerBiasA = Math.abs(a.labelOffset - a.sweep * 0.5)
    const centerBiasB = Math.abs(b.labelOffset - b.sweep * 0.5)
    if (centerBiasA !== centerBiasB) {
      return centerBiasA - centerBiasB
    }
    if (a.reachCount !== b.reachCount) {
      return b.reachCount - a.reachCount
    }
    if (a.overlapLength !== b.overlapLength) {
      return b.overlapLength - a.overlapLength
    }
    return a.overflow - b.overflow
  })

  return rankedCandidates[0]
}

function getOffsetAlongArc(
  startAngle: number,
  targetAngle: number,
  directionSign: number
) {
  const ccw = directionSign >= 0
  return getAngleDiff(startAngle, targetAngle, ccw)
}

type DistanceRange = {
  start: number
  end: number
}

function rayIntervalWithinSegment(
  line: LineSegment,
  center: Coords2d,
  rayDirection: Coords2d
): DistanceRange | null {
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

function setArcLinePositions(
  line: Line2,
  center: Coords2d,
  radius: number,
  startAngle: number,
  directionSign: number,
  startOffset: number,
  endOffset: number
) {
  const sweep = Math.max(0, endOffset - startOffset)
  const segmentCount = Math.max(2, Math.ceil((sweep / TWO_PI) * 64))
  const positions: number[] = []

  if (sweep < 1e-4) {
    const point = pointOnArc(
      center,
      radius,
      startAngle,
      directionSign,
      startOffset
    )
    line.geometry.setPositions([point.x, point.y, 0, point.x, point.y, 0])
    return
  }

  for (let index = 0; index <= segmentCount; index++) {
    const t = index / segmentCount
    const offset = startOffset + sweep * t
    const point = pointOnArc(center, radius, startAngle, directionSign, offset)
    positions.push(point.x, point.y, 0)
  }

  line.geometry.setPositions(positions)
}

function pointOnArc(
  center: Coords2d,
  radius: number,
  startAngle: number,
  directionSign: number,
  offset: number
) {
  const angle = startAngle + directionSign * offset
  return new Vector3(
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
    0
  )
}

function tangentForArc(angle: number, directionSign: number) {
  return new Vector3(
    -directionSign * Math.sin(angle),
    directionSign * Math.cos(angle),
    0
  )
}

function directionToArrowRotation(direction: Vector3) {
  return Math.atan2(direction.y, direction.x) - Math.PI / 2
}

function normaliseAngleRadians(angle: number) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI
}
