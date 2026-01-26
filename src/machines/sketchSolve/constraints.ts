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
  SEGMENT_WIDTH_PX,
} from '@src/clientSideScene/sceneConstants'
import { getResolvedTheme, Themes } from '@src/lib/theme'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

const CONSTRAINT_COLOR = {
  [Themes.Dark]: 0x121212,
  [Themes.Light]: 0xd9d9d9,
}

function createArrowGeometry(): BufferGeometry {
  const geom = new BufferGeometry()
  const vertices = new Float32Array([-3.5, 0, 0, 0, 10, 0, 3.5, 0, 0])
  geom.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  return geom
}

export function initConstraintGroup(
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
    const offset = perp.multiplyScalar(30 * scale)

    const start = p1.clone().add(offset)
    const end = p2.clone().add(offset)

    const theme = getResolvedTheme(sceneInfra.theme)
    const constraintColor = CONSTRAINT_COLOR[theme]

    const lineGeom = new LineGeometry()
    lineGeom.setPositions([start.x, start.y, 0, end.x, end.y, 0])
    const lineMat = new LineMaterial({
      color: constraintColor,
      linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
      worldUnits: false,
    })
    const line = new Line2(lineGeom, lineMat)
    line.userData.type = DISTANCE_CONSTRAINT_BODY
    group.add(line)

    const arrowGeom = createArrowGeometry()
    const arrowMat = new MeshBasicMaterial({
      color: constraintColor,
      side: DoubleSide,
    })

    const angle = Math.atan2(dir.y, dir.x)

    const arrow1 = new Mesh(arrowGeom, arrowMat)
    arrow1.position.copy(start)
    arrow1.rotation.z = angle + Math.PI / 2
    arrow1.scale.setScalar(scale)
    arrow1.userData.type = DISTANCE_CONSTRAINT_ARROW
    group.add(arrow1)

    const arrow2 = new Mesh(arrowGeom, arrowMat)
    arrow2.position.copy(end)
    arrow2.rotation.z = angle - Math.PI / 2
    arrow2.scale.setScalar(scale)
    arrow2.userData.type = DISTANCE_CONSTRAINT_ARROW
    group.add(arrow2)
  }

  return group
}
