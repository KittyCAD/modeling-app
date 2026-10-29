import type { Segment3d } from '@rust/kcl-lib/bindings/FrontendApi'
import type { CameraControls } from '@src/clientSideScene/CameraControls'
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'

/** Engine zoom-to-fit cannot see geometry rendered only in the client scene. */
export function fitSketch3dView(
  segments: Segment3d[],
  controls: Pick<CameraControls, 'camera' | 'target' | 'update'>
): boolean {
  const points = segments.flatMap(sampleSegment3d)
  if (!points.length) return false
  const bounds = new Box3().setFromPoints(points)
  const center = bounds.getCenter(new Vector3())
  const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 1)
  const camera = controls.camera
  const direction = camera.position.clone().sub(controls.target).normalize()
  if (direction.lengthSq() === 0) direction.set(1, -1, 1).normalize()
  let distance = radius * 3
  if (camera instanceof PerspectiveCamera) {
    const halfVertical = (camera.fov * Math.PI) / 360
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect)
    distance = (radius * 1.2) / Math.sin(Math.min(halfVertical, halfHorizontal))
  } else if (camera instanceof OrthographicCamera) {
    camera.zoom =
      Math.min(camera.right - camera.left, camera.top - camera.bottom) /
      (radius * 2.4)
  }
  controls.target.copy(center)
  camera.position.copy(center).addScaledVector(direction, distance)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  controls.update(true)
  return true
}

/** Sample circular geometry in its own plane, preserving the authored traversal. */
export function sampleSegment3d(segment: Segment3d): Vector3[] {
  const points = segment.points.map((p) => new Vector3(...p))
  if (segment.kind === 'point' || segment.kind === 'line') return points
  const center = points.at(-1)
  const start = points[0]
  if (!center || !start || !segment.normal) return []
  const normal = new Vector3(...segment.normal).normalize()
  const radial = start.clone().sub(center)
  const radius = radial.length()
  const u = radial.normalize()
  const v = normal.clone().cross(u)
  let angle = Math.PI * 2
  if (segment.kind === 'arc' && points[1]) {
    const end = points[1].clone().sub(center)
    angle = Math.atan2(end.dot(v), end.dot(u))
    if (segment.clockwise) {
      if (angle >= 0) angle -= Math.PI * 2
    } else if (angle <= 0) angle += Math.PI * 2
  }
  return Array.from({ length: 97 }, (_, i) => {
    const theta = (angle * i) / 96
    return center
      .clone()
      .addScaledVector(u, radius * Math.cos(theta))
      .addScaledVector(v, radius * Math.sin(theta))
  })
}
