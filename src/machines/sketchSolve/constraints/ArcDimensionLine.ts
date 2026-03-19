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
import {
  CONSTRAINT_COLOR,
  updateLabelHitObjects,
  updateLabel,
} from '@src/machines/sketchSolve/constraints/DimensionLine'
import type { SpriteLabel } from '@src/machines/sketchSolve/constraints/constraintUtils'
import { dot2d, polar2d, subVec } from '@src/lib/utils2d'
import type { Group, Mesh } from 'three'
import type { Line2 } from 'three/examples/jsm/lines/Line2'
import { createArcPositions } from '@src/machines/sketchSolve/arcPositions'

export const ANGLE_CONSTRAINT_ARC_BODY_ROLE = 'angle-constraint-arc-body'
export const ANGLE_CONSTRAINT_GUIDE_BODY_ROLE = 'angle-constraint-guide-body'
const ARROW_LENGTH_PX = 10

export type LineSegment = readonly [Coords2d, Coords2d]

export type ArcLineInfo = {
  line1: LineSegment
  line2: LineSegment
  labelPosition: Coords2d
  center: Coords2d
  radius: number
  startAngle: number
  sweepAngle: number
}

export function updateArcDimensionLine(
  renderInput: ArcLineInfo,
  group: Group,
  obj: ApiObject,
  scale: number,
  sceneInfra: SceneInfra,
  angleValue: ApiNumber
) {
  const { center, radius, startAngle, sweepAngle: sweep } = renderInput
  const arcLengthPx = (radius * sweep) / scale

  const label = group.children.find(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
  ) as SpriteLabel
  label.position.set(
    renderInput.labelPosition[0],
    renderInput.labelPosition[1],
    0
  )

  const theme = getResolvedTheme(sceneInfra.theme)
  const constraintColor = CONSTRAINT_COLOR[theme]
  const labelTextWidthPx = updateLabel(
    group,
    obj,
    constraintColor,
    angleValue,
    scale
  )
  const arrowSpanPx = ARROW_LENGTH_PX * 2
  const gapWidthPx = labelTextWidthPx
  const showArrows = arcLengthPx >= arrowSpanPx
  const showGap = arcLengthPx >= gapWidthPx + arrowSpanPx

  // Set visibility
  for (const child of group.children) {
    if (child.userData.type === DISTANCE_CONSTRAINT_LABEL) {
      child.visible = showGap
    } else if (child.userData.type === DISTANCE_CONSTRAINT_ARROW) {
      child.visible = showArrows
    } else if (
      child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA &&
      child.userData.subtype === DISTANCE_CONSTRAINT_LABEL
    ) {
      child.visible = showGap
    } else {
      child.visible = true
    }
  }

  const halfGapAngle = showGap ? (gapWidthPx * 0.5 * scale) / radius : 0

  const labelOffset = sweep * 0.5
  const section1EndAngle = startAngle + labelOffset - halfGapAngle
  const section2StartAngle = startAngle + labelOffset + halfGapAngle
  const endAngle = startAngle + sweep

  const arcLines = group.children.filter(
    (child) =>
      child.userData.type === DISTANCE_CONSTRAINT_BODY &&
      child.userData.role === ANGLE_CONSTRAINT_ARC_BODY_ROLE
  ) as Line2[]
  updateArc(arcLines[0], center, radius, startAngle, section1EndAngle)
  updateArc(arcLines[1], center, radius, section2StartAngle, endAngle)

  const startPoint = polar2d(center, radius, startAngle)
  const endPoint = polar2d(center, radius, endAngle)
  group.userData.hitObjects = [
    {
      type: 'arc',
      center,
      start: startPoint,
      end: endPoint,
    },
  ]

  if (showGap) {
    updateLabelHitObjects(label)
  } else {
    delete label.userData.hitObjects
  }

  const arrows = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_ARROW
  ) as Mesh[]
  if (showArrows) {
    arrows[0].position.set(startPoint[0], startPoint[1], 0)
    arrows[0].rotation.z = startAngle + Math.PI
    arrows[0].scale.setScalar(scale)
    arrows[1].position.set(endPoint[0], endPoint[1], 0)
    arrows[1].rotation.z = startAngle + sweep
    arrows[1].scale.setScalar(scale)
  }

  // Guidelines (if the line doesn't reach up to the arc's end point, draw a helper line)
  const guideLines = group.children.filter(
    (child) =>
      child.userData.type === DISTANCE_CONSTRAINT_BODY &&
      child.userData.role === ANGLE_CONSTRAINT_GUIDE_BODY_ROLE
  ) as Line2[]
  updateGuideLine(guideLines[0], renderInput.line1, startPoint)
  updateGuideLine(guideLines[1], renderInput.line2, endPoint)
}

function updateArc(
  arc: Line2,
  center: Coords2d,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const positions = createArcPositions({
    center,
    radius,
    startAngle,
    endAngle,
    ccw: true,
  })
  arc.geometry.setPositions(positions)
  arc.geometry.computeBoundingSphere()
}

function updateGuideLine(
  line: Line2,
  segment: LineSegment,
  arcEndpoint: Coords2d
) {
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
  line.geometry.computeBoundingSphere()
}

function getGuideSegment(
  segment: LineSegment,
  arcEndpoint: Coords2d
): LineSegment | null {
  const segmentDirection = subVec(segment[1], segment[0])
  const t =
    dot2d(subVec(arcEndpoint, segment[0]), segmentDirection) /
    dot2d(segmentDirection, segmentDirection)

  if (t >= 0 && t <= 1) {
    return null
  }

  const segmentEdgePoint = t < 0 ? segment[0] : segment[1]
  return [segmentEdgePoint, arcEndpoint]
}
