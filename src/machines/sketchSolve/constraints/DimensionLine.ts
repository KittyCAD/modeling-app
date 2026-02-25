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
  isDiameterConstraint,
  isRadiusConstraint,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type {
  ConstraintObject,
  SpriteLabel,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { isDistanceConstraint } from '@src/machines/sketchSolve/constraints/constraintUtils'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import {
  DISTANCE_CONSTRAINT_BODY,
  DISTANCE_CONSTRAINT_ARROW,
  DISTANCE_CONSTRAINT_LABEL,
  DISTANCE_CONSTRAINT_HIT_AREA,
} from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { getResolvedTheme, Themes } from '@src/lib/theme'

// "f" function icon SVG path (from CustomIcon), scaled from 20x20 viewbox
const FUNCTION_ICON_SIZE = 36
const FUNCTION_ICON_SCALE = FUNCTION_ICON_SIZE / 20
const FUNCTION_ICON_PATH =
  'M9.99998 16.8453L9.31892 16.4521L9.0555 16.8971C8.97062 17.0405 8.87053 17.1695 8.75847 17.2832L9.99998 18L16.9282 14V6L14.0326 4.32824C14.0825 4.56025 14.0917 4.80486 14.0536 5.05265L13.9911 5.45895L15.9282 6.57735V13.4227L9.99998 16.8453ZM4.07178 6.57735L9.99382 3.15826L9.99525 3.15467L11.0151 2.58608L9.99998 2L3.07178 6V14L5.20458 15.2314C5.2906 14.9153 5.45497 14.6152 5.70024 14.3628L4.07178 13.4227V6.57735ZM12.1154 3.455C11.9554 3.425 11.7904 3.42 11.6204 3.44C11.1504 3.52 10.7504 3.76 10.4204 4.16C10.0904 4.53 9.83039 5.14 9.64039 5.99L9.35539 7.52C9.35539 7.53 9.10039 7.535 8.59039 7.535C8.08039 7.535 7.81039 7.545 7.78039 7.565C7.74039 7.585 7.69539 7.705 7.64539 7.925C7.59539 8.145 7.59039 8.28 7.63039 8.33L7.69039 8.375H8.44039C8.94039 8.375 9.19039 8.38 9.19039 8.39L8.35039 12.86C7.99039 14.69 7.77039 15.705 7.69039 15.905C7.59039 16.135 7.47039 16.285 7.33039 16.355H7.31539L7.22539 16.37C7.09539 16.37 7.03039 16.36 7.03039 16.34C7.04039 16.33 7.06039 16.315 7.09039 16.295C7.23039 16.205 7.35039 16.07 7.45039 15.89C7.64039 15.49 7.61539 15.18 7.37539 14.96C7.11539 14.72 6.78539 14.695 6.38539 14.885C6.29539 14.935 6.20539 15 6.11539 15.08C6.03539 15.17 5.97039 15.26 5.92039 15.35C5.84039 15.51 5.80039 15.695 5.80039 15.905C5.80039 16.215 5.90539 16.48 6.11539 16.7C6.23539 16.8 6.33039 16.865 6.40039 16.895C6.65039 17.025 6.91539 17.085 7.19539 17.075C7.35539 17.065 7.53039 17.015 7.72039 16.925C7.92039 16.815 8.10539 16.67 8.27539 16.49C8.81539 15.94 9.24539 14.97 9.56539 13.58C9.66539 13.19 9.90039 11.995 10.2704 9.995L10.5854 8.375H11.4704L12.3704 8.36L12.4154 8.315C12.4454 8.285 12.4854 8.175 12.5354 7.985L12.5954 7.685L12.5804 7.64C12.5304 7.57 12.2004 7.535 11.5904 7.535C11.0204 7.535 10.7354 7.525 10.7354 7.505C10.7354 7.495 10.8004 7.165 10.9304 6.515C11.1204 5.485 11.2504 4.825 11.3204 4.535C11.3404 4.445 11.3804 4.37 11.4404 4.31C11.4904 4.24 11.5454 4.195 11.6054 4.175C11.6554 4.145 11.7254 4.13 11.8154 4.13L11.9504 4.16C11.9504 4.18 11.9304 4.195 11.8904 4.205C11.7504 4.305 11.6354 4.44 11.5454 4.61C11.3554 5.01 11.3804 5.32 11.6204 5.54C11.8804 5.78 12.2104 5.805 12.6104 5.615C12.7004 5.565 12.7904 5.5 12.8804 5.42C12.9604 5.33 13.0254 5.24 13.0754 5.15C13.1554 4.99 13.1954 4.805 13.1954 4.595C13.1954 4.415 13.1554 4.245 13.0754 4.085C12.8954 3.725 12.5754 3.515 12.1154 3.455Z'
const FUNCTION_ICON_GAP = 4 // gap between icon and text

const LABEL_CANVAS_PADDING = 4 // horizontal padding on each side
export const LABEL_CANVAS_HEIGHT = 32
export const HIT_AREA_WIDTH_PX = 10 // Extended hit area width for lines in pixels
const LABEL_HIT_AREA_PADDING_PX = 8 // Extra padding around label for hit detection
const DIMENSION_LABEL_GAP_PX = 16 // The gap within the dimension line that leaves space for the numeric value
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
  group.add(line1)

  const lineGeom2 = new LineGeometry()
  lineGeom2.setPositions([0, 0, 0, 100, 100, 0])
  const line2 = new Line2(lineGeom2, materials.default.line)
  line2.userData.type = DISTANCE_CONSTRAINT_BODY
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

  // Hit areas for click detection (invisible but raycasted)

  const line1HitArea = new Mesh(resources.planeGeometry, materials.hitArea)
  line1HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
  line1HitArea.userData.subtype = DISTANCE_CONSTRAINT_BODY
  group.add(line1HitArea)

  const line2HitArea = new Mesh(resources.planeGeometry, materials.hitArea)
  line2HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
  line2HitArea.userData.subtype = DISTANCE_CONSTRAINT_BODY
  group.add(line2HitArea)

  const labelHitArea = new Mesh(resources.planeGeometry, materials.hitArea)
  labelHitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
  labelHitArea.userData.subtype = DISTANCE_CONSTRAINT_LABEL
  group.add(labelHitArea)

  return group
}

export function updateDimensionLine(
  start: Vector3,
  end: Vector3,
  group: Group,
  obj: ApiObject,
  scale: number,
  sceneInfra: SceneInfra,
  selectedIds: number[],
  hoveredId: number | null,
  distance: Number,
  resources: ConstraintResources,
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

  const label = group.children.find(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
  ) as SpriteLabel | undefined
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

  const theme = getResolvedTheme(sceneInfra.theme)
  const constraintColor = CONSTRAINT_COLOR[theme]
  resources.updateMaterials(constraintColor)

  // Pick material set based on hover/selected state
  const isSelected = selectedIds.includes(obj.id)
  const isHovered = hoveredId === obj.id
  const materialSet = isHovered
    ? resources.materials.hovered
    : isSelected
      ? resources.materials.selected
      : resources.materials.default

  // Swap materials on lines and arrows
  for (const child of group.children) {
    if (child instanceof Line2) {
      child.material = materialSet.line
    } else if (
      child instanceof Mesh &&
      child.userData.type === DISTANCE_CONSTRAINT_ARROW
    ) {
      child.material = materialSet.arrow
    }
  }

  for (const child of group.children) {
    if (child.userData.type === DISTANCE_CONSTRAINT_LABEL) {
      child.visible = showLabel
    } else if (child.userData.type === DISTANCE_CONSTRAINT_ARROW) {
      child.visible = showLabel
    } else if (
      child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA &&
      child.userData.subtype === DISTANCE_CONSTRAINT_LABEL
    ) {
      child.visible = showLabel
    } else {
      child.visible = true
    }
  }

  // Main constraint lines with optional gap. Diameter labels are offset off-line, so keep no gap.
  const halfGap =
    showLabel && !isDiameter ? (DIMENSION_LABEL_GAP_PX / 2) * scale : 0
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

  if (showLabel) {
    updateLabel(group, obj, constraintColor, distance, scale)
  }

  // Update hit areas for lines
  const hitAreas = group.children.filter(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA
  ) as Mesh[]

  // Update main constraint body hit areas
  const bodyHitAreas = hitAreas.filter(
    (hitArea) => hitArea.userData.subtype === DISTANCE_CONSTRAINT_BODY
  )
  if (bodyHitAreas[0]) {
    updateLineHitArea(
      bodyHitAreas[0],
      lineStart,
      gapStart,
      HIT_AREA_WIDTH_PX * scale
    )
  }
  if (bodyHitAreas[1]) {
    updateLineHitArea(
      bodyHitAreas[1],
      gapEnd,
      lineEnd,
      HIT_AREA_WIDTH_PX * scale
    )
  }
}

// Helper to update a line hit area
export function updateLineHitArea(
  hitArea: Mesh,
  p1: Vector3,
  p2: Vector3,
  hitWidth: number
) {
  const length = p1.distanceTo(p2)
  const midpoint = p1.clone().add(p2).multiplyScalar(0.5)
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)

  hitArea.position.copy(midpoint)
  hitArea.rotation.z = angle
  hitArea.scale.set(length, hitWidth, 1)
}

function updateLabel(
  group: Group,
  obj: ApiObject,
  constraintColor: number,
  distance: Number,
  scale: number
) {
  const label = group.children.find(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
  ) as SpriteLabel | undefined
  if (label?.material.map) {
    const canvas = label.material.map.source.data

    const dimensionLabel = parseFloat(distance.value.toFixed(3)).toString()
    const showFnIcon =
      (isDistanceConstraint(obj) ||
        isRadiusConstraint(obj) ||
        isDiameterConstraint(obj)) &&
      !obj.kind.constraint.source.is_literal

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
      if (ctx) {
        // Measure text to compute needed canvas width
        ctx.font = '24px sans-serif'
        const textMetrics = ctx.measureText(dimensionLabel)
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
        ctx.fillStyle = fillColor
        ctx.font = '24px sans-serif'
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

    label.scale.set(canvas.width * scale * 0.5, canvas.height * scale * 0.5, 1)

    // Update label hit area to match canvas size
    const labelHitAreas = group.children.filter(
      (child) =>
        child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA &&
        child.userData.subtype === DISTANCE_CONSTRAINT_LABEL
    )
    const labelHitArea = labelHitAreas[0] as Mesh
    if (labelHitArea) {
      labelHitArea.position.copy(label.position)
      labelHitArea.scale.set(
        canvas.width * scale * 0.5 + LABEL_HIT_AREA_PADDING_PX * scale,
        canvas.height * scale * 0.5 + LABEL_HIT_AREA_PADDING_PX * scale,
        1
      )
    }
  }
}
