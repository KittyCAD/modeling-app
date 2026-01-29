import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
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
import { getResolvedTheme, Themes } from '@src/lib/theme'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { editorTheme } from '@src/editor/plugins/theme'
import styles from './ConstraintEditor.module.css'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { BinaryExpression, BinaryPart, Program } from '@src/lang/wasm'
import { parse, resultIsOk } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { err } from '@src/lib/trap'

const CONSTRAINT_COLOR = {
  [Themes.Dark]: 0x121212,
  [Themes.Light]: 0xd9d9d9,
}

const SEGMENT_OFFSET_PX = 30 // Distances are placed 30 pixels from the segment
const LEADER_LINE_OVERHANG = 2 // Leader lines have 2px overhang past arrows
const DIMENSION_LABEL_GAP_PX = 16 // The gap within the dimension line that leaves space for the numeric value
const HIT_AREA_WIDTH_PX = 10 // Extended hit area width for lines in pixels
const LABEL_HIT_AREA_PADDING_PX = 8 // Extra padding around label for hit detection

export const CONSTRAINT_TYPE = 'CONSTRAINT'

export type EditingCallbacks = {
  cancel: () => void
  submit: (value: string) => void
}

export class ConstraintUtils {
  private arrowGeometry: BufferGeometry | undefined
  private editingView: EditorView | null = null
  private editingContainer: HTMLDivElement | null = null

  private callbacks: EditingCallbacks | undefined

  // TODO if these are disposed they need to be recreated
  private readonly materials = {
    arrow: new MeshBasicMaterial({
      color: 0xff0000,
      side: DoubleSide,
    }),
    line: new LineMaterial({
      color: 0xff0000,
      linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
      worldUnits: false,
    }),
    hitArea: new MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.3,
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
      const leadLine1 = new Line2(leadGeom1, this.materials.line)
      leadLine1.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
      group.add(leadLine1)

      const leadGeom2 = new LineGeometry()
      leadGeom2.setPositions([0, 0, 0, 100, 100, 0])
      const leadLine2 = new Line2(leadGeom2, this.materials.line)
      leadLine2.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
      group.add(leadLine2)

      const lineGeom1 = new LineGeometry()
      lineGeom1.setPositions([0, 0, 0, 100, 100, 0])
      const line1 = new Line2(lineGeom1, this.materials.line)
      line1.userData.type = DISTANCE_CONSTRAINT_BODY
      group.add(line1)

      const lineGeom2 = new LineGeometry()
      lineGeom2.setPositions([0, 0, 0, 100, 100, 0])
      const line2 = new Line2(lineGeom2, this.materials.line)
      line2.userData.type = DISTANCE_CONSTRAINT_BODY
      group.add(line2)

      this.arrowGeometry = this.arrowGeometry || createArrowGeometry()

      // Arrow tip is at origin, so position directly at start/end
      const arrow1 = new Mesh(this.arrowGeometry, this.materials.arrow)
      arrow1.userData.type = DISTANCE_CONSTRAINT_ARROW
      group.add(arrow1)

      const arrow2 = new Mesh(this.arrowGeometry, this.materials.arrow)
      arrow2.userData.type = DISTANCE_CONSTRAINT_ARROW
      group.add(arrow2)

      // Label sprite with canvas texture
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 32
      const texture = new CanvasTexture(canvas)
      const spriteMaterial = new SpriteMaterial({
        map: texture,
        transparent: true,
      })
      const label = new Sprite(spriteMaterial)
      label.userData.type = DISTANCE_CONSTRAINT_LABEL
      label.userData.canvas = canvas
      label.userData.texture = texture
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
    sceneInfra: SceneInfra
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

      const theme = getResolvedTheme(sceneInfra.theme)
      const constraintColor = CONSTRAINT_COLOR[theme]
      this.materials.line.color.set(constraintColor)
      this.materials.line.linewidth = SEGMENT_WIDTH_PX * window.devicePixelRatio
      this.materials.arrow.color.set(constraintColor)

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
      const halfGap = (DIMENSION_LABEL_GAP_PX / 2) * scale
      const midpoint = start.clone().add(end).multiplyScalar(0.5)
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
      )
      const arrow1 = arrows[0] as Line2
      const arrow2 = arrows[1] as Line2

      // Arrow tip is at origin, so position directly at start/end
      arrow1.position.copy(start)
      arrow1.rotation.z = angle + Math.PI / 2
      arrow1.scale.setScalar(scale)

      arrow2.position.copy(end)
      arrow2.rotation.z = angle - Math.PI / 2
      arrow2.scale.setScalar(scale)

      const label = group.children.find(
        (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
      ) as Sprite | undefined
      if (label) {
        const canvas = label.userData.canvas as HTMLCanvasElement

        const oldDimensionLabel = label.userData.dimension
        const oldConstraintColor = label.userData.constraintColor
        const newDimensionLabel = parseFloat(
          distance.value.toFixed(3)
        ).toString()

        if (
          oldDimensionLabel !== newDimensionLabel ||
          oldConstraintColor !== constraintColor
        ) {
          // Update texture: only if needed because this is not cheap
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.font = '24px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = '#' + new Color(constraintColor).getHexString()
            ctx.fillText(newDimensionLabel, canvas.width / 2, canvas.height / 2)

            // Measure actual text size for hit area
            const textMetrics = ctx.measureText(newDimensionLabel)
            label.userData.textWidth = textMetrics.width
            label.userData.textHeight = 24 // Font size approximation
          }
          const texture = label.userData.texture as CanvasTexture
          texture.needsUpdate = true
        }

        label.position.copy(midpoint)
        label.scale.set(
          canvas.width * scale * 0.5,
          canvas.height * scale * 0.5,
          1
        )

        // Update label hit area based on actual text size
        const labelHitAreas = group.children.filter(
          (child) =>
            child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA &&
            child.userData.subtype === DISTANCE_CONSTRAINT_LABEL
        )
        const labelHitArea = labelHitAreas[0] as Mesh
        if (labelHitArea) {
          const textWidth =
            (label.userData.textWidth || canvas.width) * scale * 0.5
          const textHeight = (label.userData.textHeight || 24) * scale * 0.5

          labelHitArea.position.copy(midpoint)
          labelHitArea.scale.set(
            textWidth + LABEL_HIT_AREA_PADDING_PX * scale,
            textHeight + LABEL_HIT_AREA_PADDING_PX * scale,
            1
          )
        }
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

  public stopEditingInput() {
    if (this.editingView) {
      this.editingView.destroy()
      this.editingView = null
    }
    if (this.editingContainer) {
      this.editingContainer.remove()
      this.editingContainer = null
    }
  }

  public updateEditingInput(
    constraintId: number,
    objects: Array<ApiObject>,
    sceneInfra: SceneInfra,
    callbacks: EditingCallbacks
  ): void {
    this.callbacks = callbacks

    const constraintObject = objects[constraintId]
    if (constraintObject?.kind.type === 'Constraint') {
      const constraintType = constraintObject.kind.constraint.type
      if (
        constraintType === 'Distance' ||
        constraintType === 'HorizontalDistance' ||
        constraintType === 'VerticalDistance'
      ) {
        const distance = constraintObject.kind.constraint.distance

        if (!sceneInfra) {
          console.warn('SceneInfra not available for constraint editing')
          return
        }
        const sketchSolveGroup =
          sceneInfra.scene.getObjectByName('sketchSolveGroup')
        const constraintGroup = sketchSolveGroup?.getObjectByName(
          constraintId.toString()
        )
        if (!constraintGroup) {
          console.warn(`Constraint group ${constraintId} not found in scene`)
          return
        }
        const label = constraintGroup.children.find(
          (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
        ) as Sprite | undefined
        if (!label) {
          console.warn(`Label not found in constraint group ${constraintId}`)
          return
        }

        const worldPosition = new Vector3()
        label.getWorldPosition(worldPosition)
        const screenPosition = worldPosition.clone()
        screenPosition.project(sceneInfra.camControls.camera)

        const x =
          (screenPosition.x * 0.5 + 0.5) *
          sceneInfra.renderer.domElement.clientWidth
        const y =
          (-screenPosition.y * 0.5 + 0.5) *
          sceneInfra.renderer.domElement.clientHeight

        const initialValue = parseFloat(distance.value.toFixed(3)).toString()

        if (!this.editingView || !this.editingContainer) {
          const theme = getResolvedTheme(sceneInfra.theme)
          this.editingContainer = document.createElement('div')
          this.editingContainer.className = styles.container
          const view = new EditorView({
            state: EditorState.create({
              doc: initialValue,
              extensions: [
                editorTheme[theme],
                keymap.of([
                  {
                    key: 'Enter',
                    run: (editorView) => {
                      const value = editorView.state.doc.toString().trim()
                      if (value) {
                        this.callbacks?.submit?.(value)
                        return true
                      }
                      return false
                    },
                  },
                  {
                    key: 'Escape',
                    run: () => {
                      this.callbacks?.cancel()
                      return true
                    },
                  },
                ]),
                EditorView.lineWrapping,
              ],
            }),
            parent: this.editingContainer,
          })
          this.editingView = view

          const canvasContainer = sceneInfra.renderer.domElement.parentElement
          if (canvasContainer) {
            canvasContainer.appendChild(this.editingContainer)
          }
        } else {
          // Update existing editor content
          this.editingView.dispatch({
            changes: {
              from: 0,
              to: this.editingView.state.doc.length,
              insert: initialValue,
            },
          })
        }

        // Position the container
        this.editingContainer.style.left = `${x}px`
        this.editingContainer.style.top = `${y}px`

        // Focus and select all
        this.editingView.focus()
        this.editingView.dispatch({
          selection: { anchor: 0, head: this.editingView.state.doc.length },
        })
      }
    }
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
  if (obj.kind.type !== 'Constraint') {
    return null
  }

  const constraint = obj.kind.constraint
  if (
    constraint.type === 'Distance' ||
    constraint.type === 'HorizontalDistance' ||
    constraint.type === 'VerticalDistance'
  ) {
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

  return null
}

/**
 * Updates a distance constraint value in the AST by replacing the right side
 * of the constraint's BinaryExpression with a new expression (literal or var reference)
 */
export function updateConstraintValue(
  constraintObject: ApiObject,
  ast: Program,
  newExpressionString: string,
  wasmInstance: ModuleType
): { modifiedAst: Program } | Error {
  if (constraintObject.kind.type !== 'Constraint') {
    return new Error('Object is not a constraint')
  }

  const constraintType = constraintObject.kind.constraint.type
  if (
    constraintType !== 'Distance' &&
    constraintType !== 'HorizontalDistance' &&
    constraintType !== 'VerticalDistance'
  ) {
    return new Error('Constraint type does not have a distance value')
  }

  const source = constraintObject.source
  let sourceRange: [number, number, number] | undefined

  if (source.type === 'Simple') {
    sourceRange = source.range
  } else if (source.type === 'BackTrace' && source.ranges.length > 0) {
    sourceRange = source.ranges[0]
  }

  if (!sourceRange) {
    return new Error('No source range found for constraint')
  }

  const parseResult = parse(newExpressionString, wasmInstance)
  if (err(parseResult) || !resultIsOk(parseResult)) {
    return new Error(
      `Failed to parse expression: ${err(parseResult) ? parseResult.message : 'Parse failed'}`
    )
  }

  const exprStatement = parseResult.program.body[0]
  if (exprStatement?.type !== 'ExpressionStatement') {
    return new Error('Invalid expression')
  }

  // Get the path to the BinaryExpression (sketch2::distance(...) == value)
  const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
  const modifiedAst = structuredClone(ast)

  const nodeResult = getNodeFromPath<BinaryExpression>(
    modifiedAst,
    pathToNode,
    wasmInstance,
    'BinaryExpression'
  )
  if (err(nodeResult)) {
    return nodeResult
  }

  if (nodeResult.node.type !== 'BinaryExpression') {
    return new Error(
      `Expected BinaryExpression, got ${nodeResult.node.type} at constraint location`
    )
  }

  // Replace the right side (the distance value) with the new expression
  nodeResult.node.right = exprStatement.expression as BinaryPart

  return { modifiedAst }
}
