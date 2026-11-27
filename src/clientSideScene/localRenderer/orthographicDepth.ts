import { type Box3, type OrthographicCamera, Vector3 } from 'three'

/** Fit the preview camera's depth range without changing its screen projection. */
export function fitOrthographicDepthRange(
  camera: OrthographicCamera,
  worldBounds: Box3
) {
  if (
    worldBounds.isEmpty() ||
    ![...worldBounds.min.toArray(), ...worldBounds.max.toArray()].every(
      Number.isFinite
    )
  )
    return

  camera.updateMatrixWorld(true)
  const viewBounds = worldBounds.clone().applyMatrix4(camera.matrixWorldInverse)
  const span = viewBounds.max.z - viewBounds.min.z
  // Bounds are in glTF meters. Leave room at both ends for rasterization and
  // line/plane offsets, including flat or very small sketches.
  const padding = Math.max(span * 0.05, 0.001)
  // Moving along an orthographic camera's forward axis preserves screen X/Y.
  // Keep the camera close to the geometry too, avoiding cancellation between a
  // distant view translation and a tight projection at extreme zoom levels.
  const forward = camera.getWorldDirection(new Vector3())
  camera.position.addScaledVector(forward, -viewBounds.max.z - padding)
  camera.near = padding / 2
  camera.far = span + padding * 1.5
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
}
