import {
  type Box3,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector3,
} from 'three'

import type { RecenterHint } from '@src/registry/contracts/viewportNavigation'

/** A presentation hint only; the silhouette determines whether recovery is needed. */
export function recenterHint(
  bounds: Box3,
  camera: PerspectiveCamera | OrthographicCamera
): RecenterHint {
  if (bounds.isEmpty()) return { kind: 'neutral' }
  if (bounds.containsPoint(camera.getWorldPosition(new Vector3())))
    return { kind: 'zoom-out' }
  const center = bounds
    .getCenter(new Vector3())
    .applyMatrix4(camera.matrixWorldInverse)
  // Screen-space arrows are ambiguous behind the eye or across its clip plane.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new Vector3(x, y, z).applyMatrix4(
          camera.matrixWorldInverse
        )
        if (point.z >= 0 || point.z > -camera.near) return { kind: 'neutral' }
        point.applyMatrix4(camera.projectionMatrix)
        if (![point.x, point.y].every(Number.isFinite))
          return { kind: 'neutral' }
        minX = Math.min(minX, point.x)
        maxX = Math.max(maxX, point.x)
        minY = Math.min(minY, point.y)
        maxY = Math.max(maxY, point.y)
      }
  if (center.z >= 0) return { kind: 'neutral' }
  if (minX > 1 || maxX < -1 || minY > 1 || maxY < -1) {
    center.applyMatrix4(camera.projectionMatrix)
    return {
      kind: 'direction',
      angle: (Math.atan2(-center.y, center.x) * 180) / Math.PI || 0,
    }
  }
  if (
    minX >= -1 &&
    maxX <= 1 &&
    minY >= -1 &&
    maxY <= 1 &&
    ((maxX - minX) * (maxY - minY)) / 4 <= 0.04
  )
    return { kind: 'zoom-in' }
  if (minX < -1 && maxX > 1 && minY < -1 && maxY > 1)
    return { kind: 'zoom-out' }
  return { kind: 'neutral' }
}
