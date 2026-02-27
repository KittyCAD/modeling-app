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
import { getResolvedTheme } from '@src/lib/theme'
import { clamp, cross2d, dot2d, lengthSq } from '@src/lib/utils2d'
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
import type { AngleConstraintData } from '@src/machines/sketchSolve/constraints/AngleConstraintBuilder'
import type { Coords2d } from '@src/lang/util'

export function updateArcDimensionLine(
  angleConstraintData: AngleConstraintData,
  group: Group,
  obj: ApiObject,
  scale: number,
  sceneInfra: SceneInfra,
  angleValue: ApiNumber
) {
  const { radius, center, startDirection, endDirection } = angleConstraintData
  if (radius <= 0) {
    group.visible = false
    return
  }

  if (lengthSq(startDirection) < 1e-8 || lengthSq(endDirection) < 1e-8) {
    group.visible = false
    return
  }

  const dot = clamp(dot2d(startDirection, endDirection), -1, 1)
  const sweep = Math.acos(dot)
  if (sweep < 1e-4) {
    group.visible = false
    return
  }

  const arcLengthPx = (radius * sweep) / scale
  if (arcLengthPx < DIMENSION_HIDE_THRESHOLD_PX) {
    group.visible = false
    return
  }

  group.visible = true
  const showLabel = arcLengthPx >= DIMENSION_LABEL_HIDE_THRESHOLD_PX

  const startAngle = Math.atan2(startDirection[1], startDirection[0])
  const cross = cross2d(startDirection, endDirection)
  const directionSign = cross >= 0 ? 1 : -1

  const getPointAtOffset = (offset: number) => {
    const angle = startAngle + directionSign * offset
    return new Vector3(
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
      0
    )
  }

  const labelCenter = getPointAtOffset(sweep * 0.5)
  const label = group.children.find(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
  )
  if (label) {
    label.position.copy(labelCenter)
  }

  // Some elements need to be hidden if the arc is too small to avoid UI getting too crammed
  for (const child of group.children) {
    const isLabelVisual =
      child.userData.type === DISTANCE_CONSTRAINT_LABEL ||
      child.userData.type === DISTANCE_CONSTRAINT_ARROW ||
      (child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA &&
        child.userData.subtype === DISTANCE_CONSTRAINT_LABEL)

    child.visible = isLabelVisual ? showLabel : true
  }

  // Keep arc endpoints on the constrained rays so arrow tips and arc touch the lines.
  const constrainedSweep = sweep
  const halfGapAngle = showLabel
    ? Math.min(
        (DIMENSION_LABEL_GAP_PX * 0.5 * scale) / radius,
        Math.max(0, constrainedSweep * 0.5 - 1e-4)
      )
    : 0

  const section1StartOffset = 0
  const section1EndOffset = constrainedSweep * 0.5 - halfGapAngle
  const section2StartOffset = constrainedSweep * 0.5 + halfGapAngle
  const section2EndOffset = sweep

  const lines = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_BODY
  ) as Line2[]
  const line1 = lines[0]
  const line2 = lines[1]
  if (line1) {
    setArcLinePositions(
      line1,
      center,
      radius,
      startAngle,
      directionSign,
      section1StartOffset,
      section1EndOffset
    )
  }
  if (line2) {
    setArcLinePositions(
      line2,
      center,
      radius,
      startAngle,
      directionSign,
      section2StartOffset,
      section2EndOffset
    )
  }

  const startArrowOffset = section1StartOffset
  const endArrowOffset = section2EndOffset
  const startPoint = getPointAtOffset(startArrowOffset)
  const endPoint = getPointAtOffset(endArrowOffset)
  const startTangent = tangentForArc(
    startAngle + directionSign * startArrowOffset,
    directionSign
  )
  const endTangent = tangentForArc(
    startAngle + directionSign * endArrowOffset,
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
      getPointAtOffset(section1StartOffset),
      getPointAtOffset(section1EndOffset),
      HIT_AREA_WIDTH_PX * scale
    )
  }
  if (bodyHitAreas[1]) {
    updateLineHitArea(
      bodyHitAreas[1],
      getPointAtOffset(section2StartOffset),
      getPointAtOffset(section2EndOffset),
      HIT_AREA_WIDTH_PX * scale
    )
  }
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
  const segmentCount = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * 64))
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

  for (let i = 0; i <= segmentCount; i++) {
    const t = i / segmentCount
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
