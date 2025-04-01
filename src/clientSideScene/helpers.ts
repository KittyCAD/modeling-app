import { compareVec2Epsilon2 } from 'lang/std/sketch'
import {
  GridHelper,
  Group,
  LineBasicMaterial,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'

export function createGridHelper({
  size,
  divisions,
}: {
  size: number
  divisions: number
}) {
  const gridHelperMaterial = new LineBasicMaterial({
    color: 0xaaaaaa,
    transparent: true,
    opacity: 0.5,
    depthTest: false,
  })
  const gridHelper = new GridHelper(size, divisions, 0x0000ff, 0xffffff)
  gridHelper.material = gridHelperMaterial
  gridHelper.rotation.x = Math.PI / 2
  return gridHelper
}
const fudgeFactor = 72.66985970437086

export const orthoScale = (cam: OrthographicCamera | PerspectiveCamera) =>
  (0.55 * fudgeFactor) / cam.zoom / window.innerHeight

export const perspScale = (cam: PerspectiveCamera, group: Group | Mesh) =>
  (group.position.distanceTo(cam.position) * cam.fov * fudgeFactor) /
  4000 /
  window.innerHeight

export function isQuaternionVertical(q: Quaternion) {
  const v = new Vector3(0, 0, 1).applyQuaternion(q)
  // no x or y components means it's vertical
  return compareVec2Epsilon2([v.x, v.y], [0, 0])
}

export function quaternionFromUpNForward(up: Vector3, forward: Vector3) {
  const dummyCam = new PerspectiveCamera()
  dummyCam.up.copy(up)
  dummyCam.position.copy(forward)
  dummyCam.lookAt(0, 0, 0)
  dummyCam.updateMatrix()
  return dummyCam.quaternion.clone()
}
