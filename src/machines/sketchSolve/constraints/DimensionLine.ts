import type { ApiObject, Number } from '@rust/kcl-lib/bindings/FrontendApi'

import {
  CanvasTexture,
  Group,
  Mesh,
  Sprite,
  SpriteMaterial,
  type Vector3,
  Color,
} from 'three'
import {
  CONSTRAINT_TYPE,
  isConstraintWithSource,
  isSpriteLabel,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type {
  ConstraintObject,
  SpriteLabel,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import {
  DISTANCE_CONSTRAINT_BODY,
  DISTANCE_CONSTRAINT_ARROW,
  DISTANCE_CONSTRAINT_LABEL,
} from '@src/clientSideScene/sceneConstants'
import { getResolvedTheme, Themes } from '@src/lib/theme'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { FUNCTION_ICON_PATH } from '@src/components/CustomIcon'
import type { Coords2d } from '@src/lang/util'

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
  lineGeom1.setPositions([0, 0, 0, 100, 100, 0])
  const line1 = new Line2(lineGeom1, materials.default.line)
  line1.userData.type = DISTANCE_CONSTRAINT_BODY
  line1.userData.hitObjects = 'auto'
  group.add(line1)

  const lineGeom2 = new LineGeometry()
  lineGeom2.setPositions([0, 0, 0, 100, 100, 0])
  const line2 = new Line2(lineGeom2, materials.default.line)
  line2.userData.type = DISTANCE_CONSTRAINT_BODY
  line2.userData.hitObjects = 'auto'
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
  start: Vector3,
  end: Vector3,
  group: Group,
  obj: ApiObject,
  scale: number,
  sceneInfra: SceneInfra,
  distance: Number,
  isDiameter = false
) {
  const dimensionLengthPx = start.distanceTo(end) / scale
  const lineCenter = start.clone().lerp(end, 0.5)
  const dir = end.clone().sub(start).normalize()
  const labelCenter = isDiameter
    ? lineCenter.clone().add(
        dir
          .clone()
          .set(-dir.y, dir.x, 0)
          .multiplyScalar(DIAMETER_LABEL_OFFSET_PX * scale)
      )
    : lineCenter

  const label = group.children.find(isSpriteLabel)
  if (label) {
    // Need to update label position even if it's not shown because it's used to
    // place the input box when double clicking on it.
    label.position.copy(labelCenter)
  }

  if (dimensionLengthPx < DIMENSION_HIDE_THRESHOLD_PX) {
    group.visible = false
    return
  }

  group.visible = true
  const showLabel = dimensionLengthPx >= DIMENSION_LABEL_HIDE_THRESHOLD_PX
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

  line1.geometry.setPositions([
    lineStart.x,
    lineStart.y,
    0,
    gapStart.x,
    gapStart.y,
    0,
  ])
  line2.geometry.setPositions([gapEnd.x, gapEnd.y, 0, lineEnd.x, lineEnd.y, 0])

  // Arrows
  const angle = Math.atan2(dir.y, dir.x) // TODO
  const arrows = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_ARROW
  ) as Mesh[]
  const arrow1 = arrows[0]
  const arrow2 = arrows[1]

  // Arrow tip is at origin, so position directly at start/end
  arrow1.position.copy(start)
  arrow1.rotation.z = angle + Math.PI / 2
  arrow1.scale.setScalar(scale)

  arrow2.position.copy(end)
  arrow2.rotation.z = angle - Math.PI / 2
  arrow2.scale.setScalar(scale)
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
