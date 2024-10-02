import {
  OrthographicCamera,
  PerspectiveCamera,
  Group,
  Mesh,
} from 'three'

export const fudgeFactor = 72.66985970437086

export const orthoScale = (cam: OrthographicCamera | PerspectiveCamera, innerHeight?: number) =>
  (0.55 * fudgeFactor) / cam.zoom / (innerHeight ?? window.innerHeight)

export const perspScale = (cam: PerspectiveCamera, group: Group | Mesh, innerHeight?: number) =>
  (group.position.distanceTo(cam.position) * cam.fov * fudgeFactor) /
  4000 /
  (innerHeight ?? window.innerHeight)
