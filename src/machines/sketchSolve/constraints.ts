import type {
  ApiConstraint,
  ApiObject,
  ApiObjectKind,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  Group,
  Vector3,
  BufferGeometry,
  MeshBasicMaterial,
  Mesh,
  Float32BufferAttribute,
  DoubleSide,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Color,
  PlaneGeometry,
  type Texture,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  DISTANCE_CONSTRAINT_ARROW,
  DISTANCE_CONSTRAINT_BODY,
  DISTANCE_CONSTRAINT_LABEL,
  DISTANCE_CONSTRAINT_LEADER_LINE,
  DISTANCE_CONSTRAINT_HIT_AREA,
  SEGMENT_WIDTH_PX,
} from '@src/clientSideScene/sceneConstants'
import {
  packRgbToColor,
  SKETCH_SELECTION_COLOR,
  SKETCH_SELECTION_RGB,
} from '@src/lib/constants'
import type { SnapshotFrom, StateFrom } from 'xstate'
import { getResolvedTheme, Themes } from '@src/lib/theme'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import type { Number } from '@rust/kcl-lib/bindings/FrontendApi'

// "f" function icon SVG path (from CustomIcon), scaled from 20x20 viewbox
const FUNCTION_ICON_SIZE = 36
const FUNCTION_ICON_SCALE = FUNCTION_ICON_SIZE / 20
const FUNCTION_ICON_PATH =
  'M9.99998 16.8453L9.31892 16.4521L9.0555 16.8971C8.97062 17.0405 8.87053 17.1695 8.75847 17.2832L9.99998 18L16.9282 14V6L14.0326 4.32824C14.0825 4.56025 14.0917 4.80486 14.0536 5.05265L13.9911 5.45895L15.9282 6.57735V13.4227L9.99998 16.8453ZM4.07178 6.57735L9.99382 3.15826L9.99525 3.15467L11.0151 2.58608L9.99998 2L3.07178 6V14L5.20458 15.2314C5.2906 14.9153 5.45497 14.6152 5.70024 14.3628L4.07178 13.4227V6.57735ZM12.1154 3.455C11.9554 3.425 11.7904 3.42 11.6204 3.44C11.1504 3.52 10.7504 3.76 10.4204 4.16C10.0904 4.53 9.83039 5.14 9.64039 5.99L9.35539 7.52C9.35539 7.53 9.10039 7.535 8.59039 7.535C8.08039 7.535 7.81039 7.545 7.78039 7.565C7.74039 7.585 7.69539 7.705 7.64539 7.925C7.59539 8.145 7.59039 8.28 7.63039 8.33L7.69039 8.375H8.44039C8.94039 8.375 9.19039 8.38 9.19039 8.39L8.35039 12.86C7.99039 14.69 7.77039 15.705 7.69039 15.905C7.59039 16.135 7.47039 16.285 7.33039 16.355H7.31539L7.22539 16.37C7.09539 16.37 7.03039 16.36 7.03039 16.34C7.04039 16.33 7.06039 16.315 7.09039 16.295C7.23039 16.205 7.35039 16.07 7.45039 15.89C7.64039 15.49 7.61539 15.18 7.37539 14.96C7.11539 14.72 6.78539 14.695 6.38539 14.885C6.29539 14.935 6.20539 15 6.11539 15.08C6.03539 15.17 5.97039 15.26 5.92039 15.35C5.84039 15.51 5.80039 15.695 5.80039 15.905C5.80039 16.215 5.90539 16.48 6.11539 16.7C6.23539 16.8 6.33039 16.865 6.40039 16.895C6.65039 17.025 6.91539 17.085 7.19539 17.075C7.35539 17.065 7.53039 17.015 7.72039 16.925C7.92039 16.815 8.10539 16.67 8.27539 16.49C8.81539 15.94 9.24539 14.97 9.56539 13.58C9.66539 13.19 9.90039 11.995 10.2704 9.995L10.5854 8.375H11.4704L12.3704 8.36L12.4154 8.315C12.4454 8.285 12.4854 8.175 12.5354 7.985L12.5954 7.685L12.5804 7.64C12.5304 7.57 12.2004 7.535 11.5904 7.535C11.0204 7.535 10.7354 7.525 10.7354 7.505C10.7354 7.495 10.8004 7.165 10.9304 6.515C11.1204 5.485 11.2504 4.825 11.3204 4.535C11.3404 4.445 11.3804 4.37 11.4404 4.31C11.4904 4.24 11.5454 4.195 11.6054 4.175C11.6554 4.145 11.7254 4.13 11.8154 4.13L11.9504 4.16C11.9504 4.18 11.9304 4.195 11.8904 4.205C11.7504 4.305 11.6354 4.44 11.5454 4.61C11.3554 5.01 11.3804 5.32 11.6204 5.54C11.8804 5.78 12.2104 5.805 12.6104 5.615C12.7004 5.565 12.7904 5.5 12.8804 5.42C12.9604 5.33 13.0254 5.24 13.0754 5.15C13.1554 4.99 13.1954 4.805 13.1954 4.595C13.1954 4.415 13.1554 4.245 13.0754 4.085C12.8954 3.725 12.5754 3.515 12.1154 3.455Z'
const FUNCTION_ICON_GAP = 4 // gap between icon and text
const LABEL_CANVAS_HEIGHT = 32
const LABEL_CANVAS_PADDING = 4 // horizontal padding on each side

const CONSTRAINT_COLOR = {
  [Themes.Dark]: 0x121212,
  [Themes.Light]: 0xd9d9d9,
}

const SEGMENT_OFFSET_PX = 30 // Distances are placed 30 pixels from the segment
const LEADER_LINE_OVERHANG = 2 // Leader lines have 2px overhang past arrows
const DIMENSION_LABEL_GAP_PX = 16 // The gap within the dimension line that leaves space for the numeric value
const HIT_AREA_WIDTH_PX = 10 // Extended hit area width for lines in pixels
const LABEL_HIT_AREA_PADDING_PX = 8 // Extra padding around label for hit detection
const DIMENSION_HIDE_THRESHOLD_PX = 6 // Hide all constraint rendering below this screen-space length
const DIMENSION_LABEL_HIDE_THRESHOLD_PX = 32 // Hide label/arrows below this screen-space length

export const CONSTRAINT_TYPE = 'CONSTRAINT'

const debug_hit_areas = false
const debug_label_canvas = false

export type EditingCallbacks = {
  cancel: () => void
  submit: (value: string) => void | Promise<void>
}

export class ConstraintUtils {
  private arrowGeometry: BufferGeometry | undefined

  private static readonly HOVER_COLOR = packRgbToColor(
    SKETCH_SELECTION_RGB.map((val) => Math.round(val * 0.7))
  )

  private readonly materials = {
    default: {
      arrow: new MeshBasicMaterial({ color: 0xff0000, side: DoubleSide }),
      line: new LineMaterial({
        color: 0xff0000,
        linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
        worldUnits: false,
      }),
    },
    hovered: {
      arrow: new MeshBasicMaterial({
        color: SKETCH_SELECTION_COLOR,
        side: DoubleSide,
      }),
      line: new LineMaterial({
        color: SKETCH_SELECTION_COLOR,
        linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
        worldUnits: false,
      }),
    },
    selected: {
      arrow: new MeshBasicMaterial({
        color: ConstraintUtils.HOVER_COLOR,
        side: DoubleSide,
      }),
      line: new LineMaterial({
        color: ConstraintUtils.HOVER_COLOR,
        linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
        worldUnits: false,
      }),
    },
    hitArea: new MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: debug_hit_areas ? 0.3 : 0,
      side: DoubleSide,
    }),
  }

  public init(obj: ApiObject, objects: Array<ApiObject>): Group | null {
    if (obj.kind.type !== 'Constraint') return null

    if (getEndPoints(obj, objects)) {
      const constraint = obj.kind.constraint
      const group = new Group()
      group.name = obj.id.toString()
      group.userData = {
        type: CONSTRAINT_TYPE,
        constraintType: constraint.type,
        object_id: obj.id,
      }

      const leadGeom1 = new LineGeometry()
      leadGeom1.setPositions([0, 0, 0, 100, 100, 0])
      const leadLine1 = new Line2(leadGeom1, this.materials.default.line)
      leadLine1.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
      group.add(leadLine1)

      const leadGeom2 = new LineGeometry()
      leadGeom2.setPositions([0, 0, 0, 100, 100, 0])
      const leadLine2 = new Line2(leadGeom2, this.materials.default.line)
      leadLine2.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
      group.add(leadLine2)

      const lineGeom1 = new LineGeometry()
      lineGeom1.setPositions([0, 0, 0, 100, 100, 0])
      const line1 = new Line2(lineGeom1, this.materials.default.line)
      line1.userData.type = DISTANCE_CONSTRAINT_BODY
      group.add(line1)

      const lineGeom2 = new LineGeometry()
      lineGeom2.setPositions([0, 0, 0, 100, 100, 0])
      const line2 = new Line2(lineGeom2, this.materials.default.line)
      line2.userData.type = DISTANCE_CONSTRAINT_BODY
      group.add(line2)

      this.arrowGeometry = this.arrowGeometry || createArrowGeometry()

      // Arrow tip is at origin, so position directly at start/end
      const arrow1 = new Mesh(this.arrowGeometry, this.materials.default.arrow)
      arrow1.userData.type = DISTANCE_CONSTRAINT_ARROW
      group.add(arrow1)

      const arrow2 = new Mesh(this.arrowGeometry, this.materials.default.arrow)
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
      const leadLine1HitArea = new Mesh(
        new PlaneGeometry(1, 1),
        this.materials.hitArea
      )
      leadLine1HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
      leadLine1HitArea.userData.subtype = DISTANCE_CONSTRAINT_LEADER_LINE
      group.add(leadLine1HitArea)

      const leadLine2HitArea = new Mesh(
        new PlaneGeometry(1, 1),
        this.materials.hitArea
      )
      leadLine2HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
      leadLine2HitArea.userData.subtype = DISTANCE_CONSTRAINT_LEADER_LINE
      group.add(leadLine2HitArea)

      const line1HitArea = new Mesh(
        new PlaneGeometry(1, 1),
        this.materials.hitArea
      )
      line1HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
      line1HitArea.userData.subtype = DISTANCE_CONSTRAINT_BODY
      group.add(line1HitArea)

      const line2HitArea = new Mesh(
        new PlaneGeometry(1, 1),
        this.materials.hitArea
      )
      line2HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
      line2HitArea.userData.subtype = DISTANCE_CONSTRAINT_BODY
      group.add(line2HitArea)

      const labelHitArea = new Mesh(
        new PlaneGeometry(1, 1),
        this.materials.hitArea
      )
      labelHitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
      labelHitArea.userData.subtype = DISTANCE_CONSTRAINT_LABEL
      group.add(labelHitArea)

      return group
    }

    return null
  }

  public update(
    group: Group,
    obj: ApiObject,
    objects: Array<ApiObject>,
    scale: number,
    sceneInfra: SceneInfra,
    selectedIds: number[],
    hoveredId: number | null
  ) {
    const points = getEndPoints(obj, objects)
    if (points) {
      const { p1, p2, distance } = points

      // Get constraint type to determine dimension line direction
      const constraintType =
        obj.kind.type === 'Constraint' ? obj.kind.constraint.type : 'Distance'

      // Direction along the dimension line
      let dir: Vector3
      // Perpendicular direction for offset
      let perp: Vector3
      // Start and end points on the dimension line (after offset)
      let start: Vector3
      let end: Vector3

      if (constraintType === 'HorizontalDistance') {
        // Place distance on the bottom if the points are under the X axis
        const isBottom = (p1.y + p2.y) / 2 < 0
        dir = new Vector3(p1.x < p2.x ? 1 : -1, 0, 0)
        perp = new Vector3(0, isBottom ? -1 : 1, 0)
        const offsetY =
          (isBottom ? Math.min(p1.y, p2.y) : Math.max(p1.y, p2.y)) +
          SEGMENT_OFFSET_PX * scale * (isBottom ? -1 : 1)
        start = new Vector3(p1.x, offsetY, 0)
        end = new Vector3(p2.x, offsetY, 0)
      } else if (constraintType === 'VerticalDistance') {
        // Place distance on the left side if the points are more on the left side..
        const isLeft = (p1.x + p2.x) / 2 < 0
        dir = new Vector3(0, p1.y < p2.y ? 1 : -1, 0)
        perp = new Vector3(isLeft ? -1 : 1, 0, 0)
        const offsetX =
          (isLeft ? Math.min(p1.x, p2.x) : Math.max(p1.x, p2.x)) +
          SEGMENT_OFFSET_PX * scale * (isLeft ? -1 : 1)
        start = new Vector3(offsetX, p1.y, 0)
        end = new Vector3(offsetX, p2.y, 0)
      } else {
        // "Distance": line is parallel to the segment
        dir = p2.clone().sub(p1).normalize()
        perp = new Vector3(-dir.y, dir.x, 0)
        const offset = perp.clone().multiplyScalar(SEGMENT_OFFSET_PX * scale)
        start = p1.clone().add(offset)
        end = p2.clone().add(offset)
      }

      const dimensionLengthPx = start.distanceTo(end) / scale
      const midpoint = start.clone().add(end).multiplyScalar(0.5)

      const label = group.children.find(
        (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
      ) as SpriteLabel | undefined
      if (label) {
        // Need to update label position even if it's not shown because it's used to
        // place the input box when double clicking on it.
        label.position.copy(midpoint)
      }

      if (dimensionLengthPx < DIMENSION_HIDE_THRESHOLD_PX) {
        group.visible = false
        return
      }

      group.visible = true
      const showLabel = dimensionLengthPx >= DIMENSION_LABEL_HIDE_THRESHOLD_PX

      const theme = getResolvedTheme(sceneInfra.theme)
      const constraintColor = CONSTRAINT_COLOR[theme]

      // Pick material set based on hover/selected state
      const isSelected = selectedIds.includes(obj.id)
      const isHovered = hoveredId === obj.id
      const matSet = isHovered
        ? this.materials.hovered
        : isSelected
          ? this.materials.selected
          : this.materials.default

      // Update default materials with theme color
      this.materials.default.line.color.set(constraintColor)
      this.materials.default.arrow.color.set(constraintColor)
      const linewidth = SEGMENT_WIDTH_PX * window.devicePixelRatio
      this.materials.default.line.linewidth = linewidth
      this.materials.hovered.line.linewidth = linewidth
      this.materials.selected.line.linewidth = linewidth

      // Swap materials on lines and arrows
      for (const child of group.children) {
        if (child instanceof Line2) {
          child.material = matSet.line
        } else if (
          child instanceof Mesh &&
          child.userData.type === DISTANCE_CONSTRAINT_ARROW
        ) {
          child.material = matSet.arrow
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

      // Leader lines
      const extension = perp
        .clone()
        .normalize()
        .multiplyScalar(LEADER_LINE_OVERHANG * scale)
      const leadEnd1 = start.clone().add(extension)
      const leadEnd2 = end.clone().add(extension)

      const leadLines = group.children.filter(
        (child) => child.userData.type === DISTANCE_CONSTRAINT_LEADER_LINE
      )
      const leadLine1 = leadLines[0] as Line2
      const leadLine2 = leadLines[1] as Line2

      leadLine1.geometry.setPositions([
        p1.x,
        p1.y,
        0,
        leadEnd1.x,
        leadEnd1.y,
        0,
      ])
      leadLine2.geometry.setPositions([
        p2.x,
        p2.y,
        0,
        leadEnd2.x,
        leadEnd2.y,
        0,
      ])

      // Main constraint lines with gap at center for label
      const halfGap = showLabel ? (DIMENSION_LABEL_GAP_PX / 2) * scale : 0
      const gapStart = midpoint.clone().sub(dir.clone().multiplyScalar(halfGap))
      const gapEnd = midpoint.clone().add(dir.clone().multiplyScalar(halfGap))

      const lines = group.children.filter(
        (child) => child.userData.type === DISTANCE_CONSTRAINT_BODY
      )
      const line1 = lines[0] as Line2
      const line2 = lines[1] as Line2

      line1.geometry.setPositions([
        start.x,
        start.y,
        0,
        gapStart.x,
        gapStart.y,
        0,
      ])
      line2.geometry.setPositions([gapEnd.x, gapEnd.y, 0, end.x, end.y, 0])

      // Arrows
      const angle = Math.atan2(dir.y, dir.x)
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
        this.updateLabel(group, obj, constraintColor, distance, scale)
      }

      // Update hit areas for lines
      const hitAreas = group.children.filter(
        (child) => child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA
      ) as Mesh[]

      // Helper to update a line hit area
      const updateLineHitArea = (
        hitArea: Mesh,
        p1: Vector3,
        p2: Vector3,
        hitWidth: number
      ) => {
        const length = p1.distanceTo(p2)
        const midpoint = p1.clone().add(p2).multiplyScalar(0.5)
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)

        hitArea.position.copy(midpoint)
        hitArea.rotation.z = angle
        hitArea.scale.set(length, hitWidth, 1)
      }

      // Update leader line hit areas
      const leaderHitAreas = hitAreas.filter(
        (ha) => ha.userData.subtype === DISTANCE_CONSTRAINT_LEADER_LINE
      )
      if (leaderHitAreas[0]) {
        updateLineHitArea(
          leaderHitAreas[0],
          p1,
          leadEnd1,
          HIT_AREA_WIDTH_PX * scale
        )
      }
      if (leaderHitAreas[1]) {
        updateLineHitArea(
          leaderHitAreas[1],
          p2,
          leadEnd2,
          HIT_AREA_WIDTH_PX * scale
        )
      }

      // Update main constraint body hit areas
      const bodyHitAreas = hitAreas.filter(
        (ha) => ha.userData.subtype === DISTANCE_CONSTRAINT_BODY
      )
      if (bodyHitAreas[0]) {
        updateLineHitArea(
          bodyHitAreas[0],
          start,
          gapStart,
          HIT_AREA_WIDTH_PX * scale
        )
      }
      if (bodyHitAreas[1]) {
        updateLineHitArea(
          bodyHitAreas[1],
          gapEnd,
          end,
          HIT_AREA_WIDTH_PX * scale
        )
      }
    }
  }

  private updateLabel(
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
        isDistanceConstraint(obj.kind) && !obj.kind.constraint.source.is_literal

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
            canvas.width !== canvasWidth ||
            canvas.height !== LABEL_CANVAS_HEIGHT

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

      label.scale.set(
        canvas.width * scale * 0.5,
        canvas.height * scale * 0.5,
        1
      )

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
}

type SpriteLabel = Sprite & {
  userData: {
    type: typeof DISTANCE_CONSTRAINT_LABEL
    dimensionLabel: string
    constraintColor: number
    showFnIcon: boolean
  }
  material: SpriteMaterial & {
    map: Texture<HTMLCanvasElement>
  }
}

// Arrow with tip at origin, pointing +Y, base extends into -Y
function createArrowGeometry(): BufferGeometry {
  const geom = new BufferGeometry()
  const vertices = new Float32Array([
    -3.5,
    -10,
    0, // bottom left
    0,
    0,
    0, // tip at origin
    3.5,
    -10,
    0, // bottom right
  ])
  geom.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  return geom
}

function getEndPoints(obj: ApiObject, objects: Array<ApiObject>) {
  if (!isDistanceConstraint(obj.kind)) {
    return null
  }

  const constraint = obj.kind.constraint
  const [p1Id, p2Id] = constraint.points
  const p1Obj = objects[p1Id]
  const p2Obj = objects[p2Id]

  if (
    p1Obj?.kind.type !== 'Segment' ||
    p1Obj.kind.segment.type !== 'Point' ||
    p2Obj?.kind.type !== 'Segment' ||
    p2Obj.kind.segment.type !== 'Point'
  ) {
    return null
  }

  const p1 = new Vector3(
    p1Obj.kind.segment.position.x.value,
    p1Obj.kind.segment.position.y.value,
    0
  )
  const p2 = new Vector3(
    p2Obj.kind.segment.position.x.value,
    p2Obj.kind.segment.position.y.value,
    0
  )

  return { p1, p2, distance: constraint.distance }
}

export function isDistanceConstraint(kind: ApiObjectKind): kind is {
  type: 'Constraint'
  constraint: Extract<
    ApiConstraint,
    { type: 'Distance' | 'HorizontalDistance' | 'VerticalDistance' }
  >
} {
  return (
    kind.type === 'Constraint' &&
    (kind.constraint.type === 'Distance' ||
      kind.constraint.type === 'HorizontalDistance' ||
      kind.constraint.type === 'VerticalDistance')
  )
}

export function calculateDimensionLabelScreenPosition(
  constraintId: number,
  modelingState: StateFrom<typeof modelingMachine>,
  sceneInfra: SceneInfra
): [number, number] | undefined {
  const constraintObject = getConstraintObject(constraintId, modelingState)
  if (!constraintObject) {
    console.warn(`Constraint object not found`)
    return
  }

  const sketchSolveGroup = sceneInfra.scene.getObjectByName('sketchSolveGroup')
  const constraintGroup = sketchSolveGroup?.getObjectByName(
    constraintId.toString()
  )
  if (!constraintGroup) {
    console.warn(`Constraint group ${constraintId} not found in scene`)
    return
  }
  const label = constraintGroup.children.find(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
  ) as SpriteLabel | undefined
  if (!label) {
    console.warn(`Label not found in constraint group ${constraintId}`)
    return
  }

  const worldPosition = new Vector3()
  label.getWorldPosition(worldPosition)
  const screenPosition = worldPosition
    .clone()
    .project(sceneInfra.camControls.camera)

  const x =
    (screenPosition.x * 0.5 + 0.5) * sceneInfra.renderer.domElement.clientWidth
  const y =
    (-screenPosition.y * 0.5 + 0.5) *
    sceneInfra.renderer.domElement.clientHeight

  return [x, y]
}

export function getConstraintObject(
  constraintId: number,
  modelingState: StateFrom<typeof modelingMachine>
): ApiObject | undefined {
  const snapshot = modelingState.children.sketchSolveMachine?.getSnapshot() as
    | SnapshotFrom<typeof sketchSolveMachine>
    | undefined
  const objects =
    snapshot?.context?.sketchExecOutcome?.sceneGraphDelta.new_graph.objects ||
    []

  const constraintObject = objects[constraintId]
  return constraintObject
}
