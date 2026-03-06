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
  DIMENSION_HIDE_THRESHOLD_PX,
  updateLabel,
} from '@src/machines/sketchSolve/constraints/DimensionLine'
import { Vector3 } from 'three'
import type { Group, Mesh } from 'three'
import type { Line2 } from 'three/examples/jsm/lines/Line2'
import { createArcPositions } from '@src/machines/sketchSolve/arcPositions'

export const ANGLE_CONSTRAINT_ARC_BODY_ROLE = 'angle-constraint-arc-body'
export const ANGLE_CONSTRAINT_GUIDE_BODY_ROLE = 'angle-constraint-guide-body'
const ARROW_LENGTH_PX = 10

export type LineSegment = readonly [Coords2d, Coords2d]

export type ArcLineInfo = {
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
  if (arcLengthPx < DIMENSION_HIDE_THRESHOLD_PX) {
    group.visible = false
    return
  }
  group.visible = true

  const label = group.children.find(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
  )!
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
  const section1StartAngle = startAngle
  const section1EndAngle = startAngle + labelOffset - halfGapAngle
  const section2StartAngle = startAngle + labelOffset + halfGapAngle
  const section2EndAngle = startAngle + sweep
  const section1 = getArcSection(
    center,
    radius,
    section1StartAngle,
    section1EndAngle
  )
  const section2 = getArcSection(
    center,
    radius,
    section2StartAngle,
    section2EndAngle
  )

  const arcLines = group.children.filter(
    (child) =>
      child.userData.type === DISTANCE_CONSTRAINT_BODY &&
      child.userData.role === ANGLE_CONSTRAINT_ARC_BODY_ROLE
  ) as Line2[]
  arcLines[0].geometry.setPositions(section1.positions)
  arcLines[0].geometry.computeBoundingSphere()

  arcLines[1].geometry.setPositions(section2.positions)
  arcLines[1].geometry.computeBoundingSphere()

  const startPoint = section1.startPoint
  const endPoint = section2.endPoint
  const startTangent = section1.startTangent
  const endTangent = section2.endTangent

  const arrows = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_ARROW
  ) as Mesh[]
  const arrow1 = arrows[0]
  const arrow2 = arrows[1]
  if (arrow1 && showArrows) {
    arrow1.position.copy(startPoint)
    arrow1.rotation.z = directionToArrowRotation(startTangent.clone().negate())
    arrow1.scale.setScalar(scale)
  }
  if (arrow2 && showArrows) {
    arrow2.position.copy(endPoint)
    arrow2.rotation.z = directionToArrowRotation(endTangent)
    arrow2.scale.setScalar(scale)
  }

  for (const guideLine of getGuideBodyLines(group)) {
    guideLine.visible = false
  }
}

function getGuideBodyLines(group: Group): Line2[] {
  return group.children.filter(
    (child) =>
      child.userData.type === DISTANCE_CONSTRAINT_BODY &&
      child.userData.role === ANGLE_CONSTRAINT_GUIDE_BODY_ROLE
  ) as Line2[]
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
  sectionStartAngle: number,
  sectionEndAngle: number
): ArcSection {
  return {
    positions: createArcPositions({
      center,
      radius,
      startAngle: sectionStartAngle,
      endAngle: sectionEndAngle,
      ccw: true,
    }),
    startPoint: pointOnArc(center, radius, sectionStartAngle),
    endPoint: pointOnArc(center, radius, sectionEndAngle),
    startTangent: tangentForAngle(sectionStartAngle),
    endTangent: tangentForAngle(sectionEndAngle),
  }
}

function pointOnArc(center: Coords2d, radius: number, angle: number) {
  return new Vector3(
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
    0
  )
}

function tangentForAngle(angle: number) {
  return new Vector3(-Math.sin(angle), Math.cos(angle), 0)
}

function directionToArrowRotation(direction: Vector3) {
  return Math.atan2(direction.y, direction.x) - Math.PI / 2
}
