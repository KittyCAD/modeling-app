import { Coords2d } from 'lang/std/sketch'
import {
  ConeGeometry,
  ExtrudeGeometry,
  Group,
  LineCurve3,
  Mesh,
  MeshBasicMaterial,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three'
import { PathToNode } from 'lang/wasm'

export function straightSegment({
  from,
  to,
  id,
  pathToNode,
}: {
  from: Coords2d
  to: Coords2d
  id: string
  pathToNode: PathToNode
}): Group {
  const group = new Group()

  const shape = new Shape()
  shape.moveTo(0, -0.08)
  shape.lineTo(0, 0.08) // The width of the line

  const line = new LineCurve3(
    new Vector3(from[0], from[1], 0),
    new Vector3(to[0], to[1], 0)
  )

  const geometry = new ExtrudeGeometry(shape, {
    steps: 100,
    bevelEnabled: false,
    extrudePath: line,
  })

  const material = new MeshBasicMaterial({ color: 0xffffff })
  const mesh = new Mesh(geometry, material)
  mesh.userData.type = 'straight-segment-body'

  group.userData = {
    type: 'straight-segment',
    id,
    from,
    to,
    pathToNode,
  }

  const arrowheadMesh = new Mesh(new ConeGeometry(0.3, 0.9, 16), material)
  arrowheadMesh.position.set(0, -0.35, 0)
  const sphereMesh = new Mesh(new SphereGeometry(0.3, 16, 16), material)

  const arrowGroup = new Group()
  arrowGroup.userData.type = 'arrowhead'
  arrowGroup.add(arrowheadMesh)
  arrowGroup.add(sphereMesh)
  arrowGroup.lookAt(new Vector3(0, 1, 0))
  arrowGroup.position.set(to[0], to[1], 0)
  const dir = new Vector3()
    .subVectors(new Vector3(to[0], to[1], 0), new Vector3(from[0], from[1], 0))
    .normalize()
  arrowGroup.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)

  group.add(mesh, arrowGroup)

  return group
}
