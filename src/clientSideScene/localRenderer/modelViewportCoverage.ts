import {
  Box2,
  type Box3,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector2,
  Vector3,
} from 'three'

/** A conservative screen-area estimate; excludes grids and reference planes. */
export function modelViewportCoverage(
  bounds: Box3,
  camera: PerspectiveCamera | OrthographicCamera
): number | undefined {
  if (bounds.isEmpty()) return undefined
  camera.updateMatrixWorld(true)
  const corners: Vector3[] = []
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        corners.push(
          new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse)
        )
      }
    }
  }

  const screenBounds = new Box2()
  const include = (point: Vector3) => {
    const projected = point.clone().applyMatrix4(camera.projectionMatrix)
    screenBounds.expandByPoint(new Vector2(projected.x, projected.y))
  }
  // Clip the twelve box edges before projecting. Corners behind the camera
  // would otherwise flip across the screen or project through infinity.
  for (let i = 0; i < corners.length; i++) {
    for (const axis of [1, 2, 4]) {
      const j = i ^ axis
      if (j < i) continue
      const a = corners[i]
      const b = corners[j]
      const dz = b.z - a.z
      if (dz === 0) {
        if (a.z <= -camera.near && a.z >= -camera.far) {
          include(a)
          include(b)
        }
        continue
      }
      const near = (-camera.near - a.z) / dz
      const far = (-camera.far - a.z) / dz
      const start = Math.max(0, Math.min(near, far))
      const end = Math.min(1, Math.max(near, far))
      if (start > end) continue
      include(a.clone().lerp(b, start))
      include(a.clone().lerp(b, end))
    }
  }
  if (screenBounds.isEmpty()) return 0
  const width = Math.max(
    0,
    Math.min(1, screenBounds.max.x) - Math.max(-1, screenBounds.min.x)
  )
  const height = Math.max(
    0,
    Math.min(1, screenBounds.max.y) - Math.max(-1, screenBounds.min.y)
  )
  // Normalized device coordinates cover [-1, 1] on each axis.
  return (width * height) / 4
}
