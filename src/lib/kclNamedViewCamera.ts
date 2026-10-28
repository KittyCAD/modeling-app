import type {
  ArtifactCameraView,
  ArtifactOrientation,
  ArtifactPoint3d,
} from '@rust/kcl-lib/bindings/Artifact'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { AxisNames } from '@src/lib/constants'
import { err } from '@src/lib/trap'

const ORIENTATION_AXES = {
  front: AxisNames.NEG_Y,
  back: AxisNames.Y,
  left: AxisNames.NEG_X,
  right: AxisNames.X,
  top: AxisNames.Z,
  bottom: AxisNames.NEG_Z,
  isometric: null, // viewIsometric() positions this
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
}: {
  camera: ArtifactCameraView
  sceneInfra: SceneInfra
}): Promise<void> {
  await applyProjection({ camera, sceneInfra })

  const target = camera.target ? enginePoint(camera.target) : undefined
  const distance = camera.distance ?? undefined

  if (camera.look.type === 'oriented') {
    const axis = ORIENTATION_AXES[camera.look.orientation]

    if (axis === null) {
      // viewIsometric() frames the model itself.
      await sceneInfra.camControls.viewIsometric({ padding: FIT_PADDING })

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
    })
  }

  if (target === undefined || distance === undefined) {
    await sceneInfra.camControls.zoomToFit({ padding: FIT_PADDING })
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
}: {
  direction: ArtifactPoint3d
  up: ArtifactPoint3d
  target: { x: number; y: number; z: number } | undefined
  distance: number | undefined
  sceneInfra: SceneInfra
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

  await sceneInfra.camControls.lookAt({
    center,
    vantage: {
      x: center.x - direction.x * eyeDistance,
      y: center.y - direction.y * eyeDistance,
      z: center.z - direction.z * eyeDistance,
    },
    up: enginePoint(up),
  })
}
