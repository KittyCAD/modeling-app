import {
  engineCommandManager,
  sceneInfra,
  settingsActor,
} from '@src/lib/singletons'
import { engineViewIsometric } from '@src/lib/utils'

/**
 * Reset the camera position to a baseline, which is isometric for
 * normal users.
 */
export async function resetCameraPosition() {
  // We need a padding of 0.1 for zoom_to_fit for all E2E tests since they were originally
  // written with zoom_to_fit with padding 0.1
  const padding = 0.1
  // Get user camera projection
  const cameraProjection =
    settingsActor.getSnapshot().context.modeling.cameraProjection.current

  // We need to keep the users projection setting when resetting their camera
  if (cameraProjection === 'perspective') {
    await sceneInfra.camControls.usePerspectiveCamera()
  }

  await engineViewIsometric({
    engineCommandManager,
    padding,
  })
}
