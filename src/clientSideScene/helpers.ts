import {
  GridHelper,
  LineBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Group,
  Mesh,
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
  })
  const gridHelper = new GridHelper(size, divisions, 0x0000ff, 0xffffff)
  gridHelper.material = gridHelperMaterial
  gridHelper.rotation.x = Math.PI / 2
  return gridHelper
}

export const orthoScale = (cam: OrthographicCamera | PerspectiveCamera) =>
  0.55 / cam.zoom

export const perspScale = (cam: PerspectiveCamera, group: Group | Mesh) =>
  (group.position.distanceTo(cam.position) * cam.fov) / 4000
