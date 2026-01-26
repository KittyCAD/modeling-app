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
  private arrowMaterial = new MeshBasicMaterial({
    color: CONSTRAINT_COLOR[Themes.Dark],
    side: DoubleSide,
  })

  public initConstraintGroup(
    obj: ApiObject,
    objects: Array<ApiObject>,
    scale: number,
    sceneInfra: SceneInfra
  ): Group | null {
    if (obj.kind.type !== 'Constraint') return null

    const constraint = obj.kind.constraint
    const group = new Group()
    group.name = obj.id.toString()
    group.userData = { type: 'constraint', constraintType: constraint.type }

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

      // Offset 30px perpendicular to the line
      const dir = p2.clone().sub(p1).normalize()
      const perp = new Vector3(-dir.y, dir.x, 0)
      const offset = perp.multiplyScalar(SEGMENT_OFFSET_PX * scale)

      const start = p1.clone().add(offset)
      const end = p2.clone().add(offset)

      const theme = getResolvedTheme(sceneInfra.theme)
      const constraintColor = CONSTRAINT_COLOR[theme]

      const extension = perp
        .clone()
        .normalize()
        .multiplyScalar(LEADER_LINE_OVERHANG * scale)
      const leadEnd1 = start.clone().add(extension)
      const leadEnd2 = end.clone().add(extension)

      const leadLineMat = new LineMaterial({
        color: constraintColor,
        linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
        worldUnits: false,
      })

      const leadGeom1 = new LineGeometry()
      leadGeom1.setPositions([p1.x, p1.y, 0, leadEnd1.x, leadEnd1.y, 0])
      const leadLine1 = new Line2(leadGeom1, leadLineMat)
      leadLine1.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
      group.add(leadLine1)

      const leadGeom2 = new LineGeometry()
      leadGeom2.setPositions([p2.x, p2.y, 0, leadEnd2.x, leadEnd2.y, 0])
      const leadLine2 = new Line2(leadGeom2, leadLineMat)
      leadLine2.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
      group.add(leadLine2)

      // Main constraint lines with gap at center for label
      const halfGap = (DIMENSION_LABEL_GAP_PX / 2) * scale
      const midpoint = start.clone().add(end).multiplyScalar(0.5)
      const gapStart = midpoint.clone().sub(dir.clone().multiplyScalar(halfGap))
      const gapEnd = midpoint.clone().add(dir.clone().multiplyScalar(halfGap))

      const lineMat = new LineMaterial({
        color: constraintColor,
        linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
        worldUnits: false,
      })

      const lineGeom1 = new LineGeometry()
      lineGeom1.setPositions([start.x, start.y, 0, gapStart.x, gapStart.y, 0])
      const line1 = new Line2(lineGeom1, lineMat)
      line1.userData.type = DISTANCE_CONSTRAINT_BODY
      group.add(line1)

      const lineGeom2 = new LineGeometry()
      lineGeom2.setPositions([gapEnd.x, gapEnd.y, 0, end.x, end.y, 0])
      const line2 = new Line2(lineGeom2, lineMat)
      line2.userData.type = DISTANCE_CONSTRAINT_BODY
      group.add(line2)

      this.arrowGeometry = this.arrowGeometry || createArrowGeometry()
      this.arrowMaterial.color.set(constraintColor)

      const angle = Math.atan2(dir.y, dir.x)

      // Arrow tip is at origin, so position directly at start/end
      const arrow1 = new Mesh(this.arrowGeometry, this.arrowMaterial)
      arrow1.position.copy(start)
      arrow1.rotation.z = angle + Math.PI / 2
      arrow1.scale.setScalar(scale)
      arrow1.userData.type = DISTANCE_CONSTRAINT_ARROW
      group.add(arrow1)

      const arrow2 = new Mesh(this.arrowGeometry, this.arrowMaterial)
      arrow2.position.copy(end)
      arrow2.rotation.z = angle - Math.PI / 2
      arrow2.scale.setScalar(scale)
      arrow2.userData.type = DISTANCE_CONSTRAINT_ARROW
      group.add(arrow2)
    }

    return group
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
