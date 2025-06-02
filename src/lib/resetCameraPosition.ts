import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { isPlaywright } from '@src/lib/isPlaywright'
import {
  engineCommandManager,
  kclManager,
  sceneInfra,
  settingsActor,
} from '@src/lib/singletons'
import {
  engineStreamZoomToFit,
  engineViewIsometricWithoutGeometryPresent,
  engineViewIsometricWithGeometryPresent,
} from '@src/lib/utils'
import { AxisNames } from '@src/lib/constants'
import { v4 } from 'uuid'
const uuidv4 = v4

/**
 * Reset the camera position to a baseline, which is isometric for
 * normal users and a deprecated "front-down" view for playwright tests.
 *
 * Gotcha: Playwright E2E tests will be zoom_to_fit, when you try to recreate the e2e test manually
 * your localhost will do view_isometric. Turn this boolean on to have the same experience when manually
 * debugging e2e tests
 */
export async function resetCameraPosition() {
  // We need a padding of 0.1 for zoom_to_fit for all E2E tests since they were originally
  // written with zoom_to_fit with padding 0.1
  const padding = 0.1
  if (isPlaywright()) {
    await engineStreamZoomToFit({ engineCommandManager, padding })
  } else {
    // Get user camera projection
    const cameraProjection =
      settingsActor.getSnapshot().context.modeling.cameraProjection.current

    // TODO: Kevin remove after debugging
    // sceneInfra.camControls.updateCameraToAxis(AxisNames.NEG_Y)
    // /**
    //  * HACK: We need to update the gizmo, the command above doesn't trigger gizmo
    //  * to render which makes the axis point in an old direction.
    //  */
    // await engineCommandManager.sendSceneCommand({
    //   type: 'modeling_cmd_req',
    //   cmd_id: uuidv4(),
    //   cmd: {
    //     type: 'default_camera_get_settings',
    //   },
    // })
    // return

    // We need to keep the users projection setting when resetting their camera
    if (cameraProjection === 'perspective') {
      await sceneInfra.camControls.usePerspectiveCamera()
    }

    // If the scene is empty you cannot use view_isometric, it will not move the camera
    if (kclManager.isAstBodyEmpty(kclManager.ast)) {
      await engineViewIsometricWithoutGeometryPresent({
        engineCommandManager,
        unit:
          kclManager.fileSettings.defaultLengthUnit ||
          DEFAULT_DEFAULT_LENGTH_UNIT,
        cameraProjection,
      })
    } else {
      await engineViewIsometricWithGeometryPresent({
        engineCommandManager,
        padding,
      })
    }
  }
}
