import type { ApiObject, Number } from '@rust/kcl-lib/bindings/FrontendApi'

import {
  DISTANCE_CONSTRAINT_ARROW,
  DISTANCE_CONSTRAINT_BODY,
  DISTANCE_CONSTRAINT_LABEL,
} from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { FUNCTION_ICON_PATH } from '@src/components/CustomIcon'
import type { Coords2d } from '@src/lang/util'
import { Themes, getResolvedTheme } from '@src/lib/theme'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  CONSTRAINT_TYPE,
  isConstraintWithSource,
  isSpriteLabel,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type {
  ConstraintObject,
  SpriteLabel,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Vector3 as Vector3Type,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'

// "f" function icon SVG path (from CustomIcon), scaled from 20x20 viewbox
const FUNCTION_ICON_SIZE = 36
const FUNCTION_ICON_SCALE = FUNCTION_ICON_SIZE / 20
const FUNCTION_ICON_GAP = 4 // gap between icon and text

const LABEL_CANVAS_PADDING = 4 // horizontal padding on each side
export const LABEL_CANVAS_HEIGHT = 32
const DIMENSION_LINE_END_INSET_PX = 8 // Shorten line ends so arrows fully cover them
const DIAMETER_LABEL_OFFSET_PX = 25 // Offset diameter label off the line to avoid the center point
export const DIMENSION_HIDE_THRESHOLD_PX = 6 // Hide all constraint rendering below this screen-space length
export const DIMENSION_LABEL_HIDE_THRESHOLD_PX = 32 // Hide label/arrows below this screen-space length
const COLLAPSED_DIMENSION_MARKER_HALF_LENGTH_PX = 6
const COLLAPSED_DIMENSION_LABEL_OFFSET_PX = 18

const debug_label_canvas = false

export const CONSTRAINT_COLOR = {
  [Themes.Dark]: 0x121212,
  [Themes.Light]: 0xd9d9d9,
}

export function createDimensionLine(
  obj: ConstraintObject,
  resources: ConstraintResources
) {
  const constraint = obj.kind.constraint
  const group = new Group()
  group.name = obj.id.toString()
  group.userData = {
    type: CONSTRAINT_TYPE,
    constraintType: constraint.type,
    object_id: obj.id,
  }

  const materials = resources.materials

  const lineGeom1 = new LineGeometry()
  const line1 = new Line2(lineGeom1, materials.default.line)
  line1.userData.type = DISTANCE_CONSTRAINT_BODY
  line1.userData.hitObjects = 'auto'
  line1.userData.segmentStart = new Vector3()
  line1.userData.segmentEnd = new Vector3()
  updateConstraintLinePositions(line1, [0, 0, 0, 100, 100, 0])
  group.add(line1)

  const lineGeom2 = new LineGeometry()
  const line2 = new Line2(lineGeom2, materials.default.line)
  line2.userData.type = DISTANCE_CONSTRAINT_BODY
  line2.userData.hitObjects = 'auto'
  line2.userData.segmentStart = new Vector3()
  line2.userData.segmentEnd = new Vector3()
  updateConstraintLinePositions(line2, [0, 0, 0, 100, 100, 0])
  group.add(line2)

  // Arrow tip is at origin, so position directly at start/end
  const arrow1 = new Mesh(resources.arrowGeometry, materials.default.arrow)
  arrow1.userData.type = DISTANCE_CONSTRAINT_ARROW
  group.add(arrow1)

  const arrow2 = new Mesh(resources.arrowGeometry, materials.default.arrow)
  arrow2.userData.type = DISTANCE_CONSTRAINT_ARROW
  group.add(arrow2)

  // Label sprite with canvas texture (sized dynamically in updateLabel)
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = LABEL_CANVAS_HEIGHT
  const texture = new CanvasTexture(canvas)
  const spriteMaterial = new SpriteMaterial({
    map: texture,
    transparent: true,
  })
  const label = new Sprite(spriteMaterial) as SpriteLabel
  label.userData.type = DISTANCE_CONSTRAINT_LABEL
  group.add(label)

  return group
}

export function updateDimensionLine(
  start: Vector3Type,
  end: Vector3Type,
  group: Group,
  obj: ApiObject,
  scale: number,
  sceneInfra: SceneInfra,
  distance: Number,
  isDiameter = false
) {
  const dimensionLengthPx = start.distanceTo(end) / scale
  const lineCenter = start.clone().lerp(end, 0.5)
  const collapsedAxis = getCollapsedZeroDistanceAxis(obj, distance)
  const dir = collapsedAxis ?? end.clone().sub(start).normalize()
  const labelCenter = isDiameter
    ? lineCenter.clone().add(
        dir
          .clone()
          .set(-dir.y, dir.x, 0)
          .multiplyScalar(DIAMETER_LABEL_OFFSET_PX * scale)
      )
    : collapsedAxis
      ? lineCenter
          .clone()
          .add(
            new Vector3(-collapsedAxis.y, collapsedAxis.x, 0).multiplyScalar(
              COLLAPSED_DIMENSION_LABEL_OFFSET_PX * scale
            )
          )
      : lineCenter

  const label = group.children.find(isSpriteLabel)
  if (label) {
    // Need to update label position even if it's not shown because it's used to
    // place the input box when double clicking on it.
    label.position.copy(labelCenter)
  }

  if (dimensionLengthPx < DIMENSION_HIDE_THRESHOLD_PX && !collapsedAxis) {
    group.visible = false
    return
  }

  group.visible = true
  const showLabel =
    collapsedAxis !== null ||
    dimensionLengthPx >= DIMENSION_LABEL_HIDE_THRESHOLD_PX
  let labelTextWidthPx = 0
  if (label) {
    delete label.userData.hitObjects
  }

  // Some elements need to be hidden if the line is to small to avoid UI getting too crammed
  for (const child of group.children) {
    const isLabelVisual =
      child.userData.type === DISTANCE_CONSTRAINT_LABEL ||
      child.userData.type === DISTANCE_CONSTRAINT_ARROW

    child.visible = isLabelVisual ? showLabel : true
  }

  if (showLabel) {
    const theme = getResolvedTheme(sceneInfra.theme)
    const constraintColor = CONSTRAINT_COLOR[theme]
    labelTextWidthPx = updateLabel(group, obj, constraintColor, distance, scale)
    if (label) {
      updateLabelHitObjects(label)
    }
  }

  // Main constraint lines with optional gap. Diameter labels are offset off-line, so keep no gap.
  const halfGap = showLabel && !isDiameter ? labelTextWidthPx * 0.5 * scale : 0
  const gapStart = lineCenter.clone().sub(dir.clone().multiplyScalar(halfGap))
  const gapEnd = lineCenter.clone().add(dir.clone().multiplyScalar(halfGap))
  const maxEndInset = Math.max(
    0,
    Math.min(start.distanceTo(gapStart), gapEnd.distanceTo(end))
  )
  const endInset = showLabel
    ? Math.min(DIMENSION_LINE_END_INSET_PX * scale, maxEndInset)
    : 0
  const lineStart = start.clone().add(dir.clone().multiplyScalar(endInset))
  const lineEnd = end.clone().sub(dir.clone().multiplyScalar(endInset))

  const lines = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_BODY
  )
  const line1 = lines[0] as Line2
  const line2 = lines[1] as Line2

  const arrows = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_ARROW
  ) as Mesh[]
  const arrow1 = arrows[0]
  const arrow2 = arrows[1]

  if (collapsedAxis) {
    updateCollapsedDimensionLine(
      lineCenter,
      collapsedAxis,
      line1,
      line2,
      arrow1,
      arrow2,
      scale
    )
    return
  }

  updateConstraintLinePositions(line1, [
    lineStart.x,
    lineStart.y,
    0,
    gapStart.x,
    gapStart.y,
    0,
  ])
  updateConstraintLinePositions(line2, [
    gapEnd.x,
    gapEnd.y,
    0,
    lineEnd.x,
    lineEnd.y,
    0,
  ])

  // Arrows
  const angle = Math.atan2(dir.y, dir.x) // TODO
  // Arrow tip is at origin, so position directly at start/end
  arrow1.position.copy(start)
  arrow1.rotation.z = angle + Math.PI / 2
  arrow1.scale.setScalar(scale)

  arrow2.position.copy(end)
  arrow2.rotation.z = angle - Math.PI / 2
  arrow2.scale.setScalar(scale)
}

function getCollapsedZeroDistanceAxis(
  obj: ApiObject,
  distance: Number
): Vector3 | null {
  if (distance.value !== 0 || obj.kind.type !== 'Constraint') {
    return null
  }

  if (obj.kind.constraint.type === 'Distance') {
    return new Vector3(0, 1, 0)
  }

  if (obj.kind.constraint.type === 'HorizontalDistance') {
    return new Vector3(1, 0, 0)
  }

  if (obj.kind.constraint.type === 'VerticalDistance') {
    return new Vector3(0, 1, 0)
  }

  return null
}

function updateCollapsedDimensionLine(
  center: Vector3Type,
  axis: Vector3Type,
  line1: Line2,
  line2: Line2,
  arrow1: Mesh,
  arrow2: Mesh,
  scale: number
) {
  const markerDir = new Vector3(-axis.y, axis.x, 0)
  const markerHalfLength = COLLAPSED_DIMENSION_MARKER_HALF_LENGTH_PX * scale
  const markerStart = center
    .clone()
    .sub(markerDir.clone().multiplyScalar(markerHalfLength))
  const markerEnd = center
    .clone()
    .add(markerDir.clone().multiplyScalar(markerHalfLength))

  updateConstraintLinePositions(line1, [
    markerStart.x,
    markerStart.y,
    0,
    markerEnd.x,
    markerEnd.y,
    0,
  ])
  line2.visible = false

  const angle = Math.atan2(axis.y, axis.x)
  arrow1.position.copy(center)
  arrow1.rotation.z = angle - Math.PI / 2
  arrow1.scale.setScalar(scale)

  arrow2.position.copy(center)
  arrow2.rotation.z = angle + Math.PI / 2
  arrow2.scale.setScalar(scale)
}

export function updateConstraintLinePositions(
  line: Line2,
  positions: number[]
) {
  const segmentStart =
    line.userData.segmentStart instanceof Vector3
      ? line.userData.segmentStart
      : new Vector3()
  const segmentEnd =
    line.userData.segmentEnd instanceof Vector3
      ? line.userData.segmentEnd
      : new Vector3()
  segmentStart.set(positions[0] ?? 0, positions[1] ?? 0, positions[2] ?? 0)
  segmentEnd.set(positions[3] ?? 0, positions[4] ?? 0, positions[5] ?? 0)
  line.userData.segmentStart = segmentStart
  line.userData.segmentEnd = segmentEnd
  line.geometry.setPositions(positions)
  line.geometry.computeBoundingSphere()
  line.computeLineDistances()
}

export function updateLabel(
  group: Group,
  obj: ApiObject,
  constraintColor: number,
  apiNumber: Number,
  scale: number
) {
  const label = group.children.find(isSpriteLabel)
  if (label?.material.map) {
    const canvas = label.material.map.source.data

    const dimensionLabel = formatNumber(apiNumber)
    const showFnIcon =
      isConstraintWithSource(obj) && !obj.kind.constraint.source.is_literal

    if (
      label.userData.dimensionLabel !== dimensionLabel ||
      label.userData.constraintColor !== constraintColor ||
      label.userData.showFnIcon !== showFnIcon
    ) {
      // save configuration so the texture is only updated when it needs to
      label.userData.dimensionLabel = dimensionLabel
      label.userData.constraintColor = constraintColor
      label.userData.showFnIcon = showFnIcon

      // Update texture: only if needed because this is not cheap
      const ctx = canvas.getContext('2d')
      const font = '24px sans-serif'
      if (ctx) {
        // Measure text to compute needed canvas width
        ctx.font = font
        const textMetrics = ctx.measureText(dimensionLabel)
        label.userData.textWidthPx = textMetrics.width
        const iconWidth = showFnIcon
          ? FUNCTION_ICON_SIZE + FUNCTION_ICON_GAP
          : 0
        const contentWidth = iconWidth + textMetrics.width
        const canvasWidth = Math.ceil(contentWidth + LABEL_CANVAS_PADDING * 2)
        const sizeChanged =
          canvas.width !== canvasWidth || canvas.height !== LABEL_CANVAS_HEIGHT

        canvas.width = canvasWidth
        canvas.height = LABEL_CANVAS_HEIGHT

        if (sizeChanged) {
          // Force GPU texture reallocation when the canvas shrinks.
          // Otherwise the old pixels may remain visible because three.js reuses the same texture.
          label.material.map.dispose()
          label.material.map = new CanvasTexture(canvas)
          label.material.needsUpdate = true
        }

        ctx.clearRect(0, 0, canvasWidth, LABEL_CANVAS_HEIGHT)

        if (debug_label_canvas) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }

        // Re-set context state after resize
        const fillColor = '#' + new Color(constraintColor).getHexString()
        ctx.font = font // needed after canvas resize
        ctx.fillStyle = fillColor
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'

        // Draw dimension text
        ctx.fillText(
          dimensionLabel,
          LABEL_CANVAS_PADDING + iconWidth,
          canvas.height / 2
        )

        // Draw function icon if expression is not a literal
        if (showFnIcon) {
          ctx.save()
          ctx.translate(
            LABEL_CANVAS_PADDING,
            (canvas.height - FUNCTION_ICON_SIZE) / 2
          )
          ctx.scale(FUNCTION_ICON_SCALE, FUNCTION_ICON_SCALE)
          ctx.fill(new Path2D(FUNCTION_ICON_PATH))
          ctx.restore()
        }
      }
      label.material.map.needsUpdate = true
    }

    const LABEL_SCALE = 0.5 // Render at 2x resolution for crisper text
    label.scale.set(
      canvas.width * scale * LABEL_SCALE,
      canvas.height * scale * LABEL_SCALE,
      1
    )

    return (label.userData.textWidthPx ?? 0) * LABEL_SCALE + 8
  }

  return 0
}

export function getLabelHitObjects(label: SpriteLabel): Array<{
  type: 'line'
  line: [Coords2d, Coords2d]
}> {
  const minX = label.position.x - label.scale.x / 2
  const maxX = label.position.x + label.scale.x / 2
  const minY = label.position.y - label.scale.y / 2
  const maxY = label.position.y + label.scale.y / 2

  return [
    {
      type: 'line',
      line: [
        [minX, minY],
        [maxX, minY],
      ],
    },
    {
      type: 'line',
      line: [
        [maxX, minY],
        [maxX, maxY],
      ],
    },
    {
      type: 'line',
      line: [
        [maxX, maxY],
        [minX, maxY],
      ],
    },
    {
      type: 'line',
      line: [
        [minX, maxY],
        [minX, minY],
      ],
    },
  ]
}

export function updateLabelHitObjects(label: SpriteLabel) {
  label.userData.hitObjects = getLabelHitObjects(label)
}

function formatNumber(apiNumber: Number) {
  if (['Deg', 'Rad'].includes(apiNumber.units)) {
    let value = apiNumber.value
    if (apiNumber.units === 'Rad') {
      value *= 180 / Math.PI
    }
    return parseFloat(value.toFixed(1)).toString() + '°'
  } else {
    return parseFloat(apiNumber.value.toFixed(3)).toString()
  }
}
