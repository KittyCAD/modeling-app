import type {
  ArtifactCameraView,
  ArtifactOrientation,
  ArtifactPoint3d,
} from '@rust/kcl-lib/bindings/Artifact'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { AxisNames } from '@src/lib/constants'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { engineStreamZoomToFit, engineViewIsometric } from '@src/lib/utils'
import { uuidv4 } from '@src/lib/utils'

const ORIENTATION_AXES = {
  front: AxisNames.NEG_Y,
  back: AxisNames.Y,
  left: AxisNames.NEG_X,
  right: AxisNames.X,
  top: AxisNames.Z,
  bottom: AxisNames.NEG_Z,
  isometric: null, // Engine positions this for us
} satisfies Record<ArtifactOrientation, AxisNames | null>

/**
 * Matches the padding the Zoom to fit command passes. Other `zoom_to_fit` call
 * sites use 0.2.
 */
const FIT_PADDING = 0.1

function enginePoint(point: ArtifactPoint3d): {
  x: number
  y: number
  z: number
} {
  return { x: point.x, y: point.y, z: point.z }
}

export async function applyNamedViewCamera({
  camera,
  sceneInfra,
  engineCommandManager,
}: {
  camera: ArtifactCameraView
  sceneInfra: SceneInfra
  engineCommandManager: ConnectionManager
}): Promise<void> {
  await applyProjection({ camera, sceneInfra })

  const target = camera.target ? enginePoint(camera.target) : undefined
  const distance = camera.distance ?? undefined

  if (camera.look.type === 'oriented') {
    const axis = ORIENTATION_AXES[camera.look.orientation]

    if (axis === null) {
      // `view_isometric` frames the model itself.
      await engineViewIsometric({ engineCommandManager, padding: FIT_PADDING })
      return
    }

    await sceneInfra.camControls.setCameraToAxis({ axis, target, distance })
  } else {
    await lookAlongDirection({
      direction: camera.look.direction,
      up: camera.look.up,
      target,
      distance,
      sceneInfra,
      engineCommandManager,
    })
  }

  if (target === undefined || distance === undefined) {
    await engineStreamZoomToFit({ engineCommandManager, padding: FIT_PADDING })
    await getCameraSettings(engineCommandManager)
  }
}

async function applyProjection({
  camera,
  sceneInfra,
}: {
  camera: ArtifactCameraView
  sceneInfra: SceneInfra
}): Promise<void> {
  await sceneInfra.camControls.setCameraProjection(camera.projection)
}

async function lookAlongDirection({
  direction,
  up,
  target,
  distance,
  sceneInfra,
  engineCommandManager,
}: {
  direction: ArtifactPoint3d
  up: ArtifactPoint3d
  target: { x: number; y: number; z: number } | undefined
  distance: number | undefined
  sceneInfra: SceneInfra
  engineCommandManager: ConnectionManager
}): Promise<void> {
  const center = target ?? {
    x: sceneInfra.camControls.target.x,
    y: sceneInfra.camControls.target.y,
    z: sceneInfra.camControls.target.z,
  }
  const eyeDistance =
    distance ??
    sceneInfra.camControls.camera.position.distanceTo(
      sceneInfra.camControls.target
    )

  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_look_at',
      center,
      vantage: {
        x: center.x - direction.x * eyeDistance,
        y: center.y - direction.y * eyeDistance,
        z: center.z - direction.z * eyeDistance,
      },
      up: enginePoint(up),
    },
  })
  await getCameraSettings(engineCommandManager)
}

async function getCameraSettings(
  engineCommandManager: ConnectionManager
): Promise<void> {
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_get_settings',
    },
  })
}
