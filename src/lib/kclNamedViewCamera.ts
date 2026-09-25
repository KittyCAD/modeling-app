import type {
  ArtifactCameraView,
  ArtifactOrientation,
  ArtifactPoint3d,
} from '@rust/kcl-lib/bindings/Artifact'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { NamedViewCameraSnapshot } from '@src/lang/modifyAst/namedViews'
import { AxisNames } from '@src/lib/constants'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { err } from '@src/lib/trap'
import {
  engineStreamZoomToFit,
  engineViewIsometric,
  uuidv4,
} from '@src/lib/utils'
import { Vector3 } from 'three'

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

/** Read the client camera in the form `view::directed` stores in KCL. */
export function captureNamedViewCamera(
  sceneInfra: SceneInfra
): NamedViewCameraSnapshot | Error {
  const { camera, target, isPerspective } = sceneInfra.camControls
  camera.updateMatrixWorld()

  const direction = camera.getWorldDirection(new Vector3()).normalize()
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize()
  const distance = camera.position.distanceTo(target)

  const numbers = [
    direction.x,
    direction.y,
    direction.z,
    up.x,
    up.y,
    up.z,
    target.x,
    target.y,
    target.z,
    distance,
  ]
  if (!numbers.every(Number.isFinite) || distance <= 0) {
    return new Error('Could not read the current camera.')
  }

  return {
    direction: [direction.x, direction.y, direction.z],
    up: [up.x, up.y, up.z],
    target: [target.x, target.y, target.z],
    distance,
    projection: isPerspective ? 'Perspective' : 'Orthographic',
  }
}

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

      if (target === undefined && distance === undefined) {
        return
      }

      const fittedView = await sceneInfra.camControls.getCameraView()
      if (err(fittedView)) {
        return
      }

      await sceneInfra.camControls.setCameraView({
        ...fittedView,
        pivot_position: target ?? fittedView.pivot_position,
        eye_offset: distance ?? fittedView.eye_offset,
      })
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
