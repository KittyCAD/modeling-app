import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  Group,
  Vector3,
  BufferGeometry,
  MeshBasicMaterial,
  Mesh,
  Float32BufferAttribute,
  DoubleSide,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  DISTANCE_CONSTRAINT_ARROW,
  DISTANCE_CONSTRAINT_BODY,
  DISTANCE_CONSTRAINT_LEADER_LINE,
  SEGMENT_WIDTH_PX,
} from '@src/clientSideScene/sceneConstants'
import { getResolvedTheme, Themes } from '@src/lib/theme'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

const CONSTRAINT_COLOR = {
  [Themes.Dark]: 0x121212,
  [Themes.Light]: 0xd9d9d9,
}

const SEGMENT_OFFSET_PX = 30 // Distances are placed 30 pixels from the segment
const LEADER_LINE_OVERHANG = 2 // Leader lines have 2px overhang past arrows
const DIMENSION_LABEL_GAP_PX = 16 // The gap within the dimension line that leaves space for the numeric value

export class ConstraintUtils {
  private arrowGeometry: BufferGeometry | undefined

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
  }

  public init(obj: ApiObject, objects: Array<ApiObject>): Group | null {
    if (obj.kind.type !== 'Constraint') return null

    if (getEndPoints(obj, objects)) {
      const constraint = obj.kind.constraint
      const group = new Group()
      group.name = obj.id.toString()
      group.userData = {
        type: 'constraint',
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
      const { p1, p2 } = points

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

    return { p1, p2 }
  }

  return null
}
