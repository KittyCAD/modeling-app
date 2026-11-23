import type { CameraControls } from '@src/clientSideScene/CameraControls'
import { cameraMouseDragGuards } from '@src/lib/cameraControls'
import type { SceneCameraPreferences } from '@src/lib/kcl/scene/presentationPreferences'
import {
  getSceneOverlayTheme,
  type ViewportRendering,
} from '@src/lib/settings/viewportRendering'
import type { PostEffectType } from '@kittycad/lib'
import type { Themes } from '@src/lib/theme'

/**
 * Apply input preferences independently of projection and appearance. The host
 * retains projection policy (including the legacy sketch-mode guard).
 */
export function createCameraInputApplier(
  controls: Pick<CameraControls, 'interactionGuards' | 'initTouchControls'>
) {
  let applied:
    | Pick<SceneCameraPreferences, 'mouseControls' | 'enableTouchControls'>
    | undefined
  return (
    next: Pick<SceneCameraPreferences, 'mouseControls' | 'enableTouchControls'>
  ) => {
    if (applied?.mouseControls !== next.mouseControls)
      controls.interactionGuards = cameraMouseDragGuards[next.mouseControls]
    if (applied?.enableTouchControls !== next.enableTouchControls)
      controls.initTouchControls(next.enableTouchControls)
    applied = { ...next }
  }
}

/** Keep legacy segment colors and per-view rendering callbacks outside the shared theme application. */
export function applySceneOverlayTheme(
  scene: { theme: Themes },
  theme: Themes,
  viewportRendering: PostEffectType | ViewportRendering
) {
  const overlayTheme = getSceneOverlayTheme(theme, viewportRendering)
  if (scene.theme !== overlayTheme) scene.theme = overlayTheme
  return overlayTheme
}
