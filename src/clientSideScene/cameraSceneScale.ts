// Match the engine's distance-based scale for clipping and reference planes.
// Camera-to-target distance is in mm.
export function getLocalCameraSceneScale(distance: number) {
  if (distance > 20000) return 1000
  if (distance > 2000) return 100
  if (distance > 200) return 10
  if (distance > 20) return 1
  if (distance > 2) return 0.1
  if (distance > 0.2) return 0.01
  return 0.001
}
