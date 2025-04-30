import { NODE_ENV } from '@src/env'
import { isDesktop } from '@src/lib/isDesktop'
import * as THREE from 'three'
import { uuidv4 } from '@src/lib/utils'

import { IS_PLAYWRIGHT_KEY } from '@src/lib/isPlaywright'
import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import type {
  CameraViewState_type,
  UnitLength_type,
} from '@kittycad/lib/dist/types/src/models'

const isTestEnv = window?.localStorage.getItem(IS_PLAYWRIGHT_KEY) === 'true'

export const APP_VERSION =
  isTestEnv && NODE_ENV === 'development'
    ? '11.22.33'
    : isDesktop()
      ? // @ts-ignore
        window.electron.packageJson.version
      : 'main'

export const PACKAGE_NAME = isDesktop()
  ? window.electron.packageJson.name
  : 'zoo-modeling-app'

export const IS_NIGHTLY = PACKAGE_NAME.indexOf('-nightly') > -1

export const IS_NIGHTLY_OR_DEBUG =
  IS_NIGHTLY || APP_VERSION === '0.0.0' || APP_VERSION === '11.22.33'

export function getReleaseUrl(version: string = APP_VERSION) {
  return `https://github.com/KittyCAD/modeling-app/releases/tag/${
    IS_NIGHTLY ? 'nightly-' : ''
  }v${version}`
}

export function computeIsometricQuaternionForEmptyScene() {
  // Create the direction vector you want to look from
  const isoDir = new THREE.Vector3(1, 1, 1).normalize() // isometric look direction

  // Target is the point you want to look at (e.g., origin)
  const target = new THREE.Vector3(0, 0, 0)

  // Compute quaternion for isometric view
  const up = new THREE.Vector3(0, 0, 1) // default up direction
  const quaternion = new THREE.Quaternion()
  quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), isoDir) // align -Z with isoDir

  // Optionally align up vector using a lookAt matrix
  const m = new THREE.Matrix4()
  m.lookAt(new THREE.Vector3().addVectors(target, isoDir), target, up)
  quaternion.setFromRotationMatrix(m)
  return quaternion
}

export async function engineStreamZoomToFit({
  engineCommandManager,
  padding,
}: {
  engineCommandManager: EngineCommandManager
  padding: number
}) {
  // It makes sense to also call zoom to fit here, when a new file is
  // loaded for the first time, but not overtaking the work kevin did
  // so the camera isn't moving all the time.
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'zoom_to_fit',
      object_ids: [], // leave empty to zoom to all objects
      padding, // padding around the objects
      animated: false, // don't animate the zoom for now
    },
  })
}

export async function engineViewIsometricWithGeometryPresent({
  engineCommandManager,
  padding,
}: {
  engineCommandManager: EngineCommandManager
  padding: number
}) {
  /**
   * Default all users to view_isometric when loading into the engine.
   * This works for perspective projection and orthographic projection
   * This does not change the projection of the camera only the view direction which makes
   * it safe to use with either projection defaulted
   */
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'view_isometric',
      padding, // padding around the objects
    },
  })

  /**
   * HACK: We need to update the gizmo, the command above doesn't trigger gizmo
   * to render which makes the axis point in an old direction.
   */
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_get_settings',
    },
  })
}

export async function engineViewIsometricWithoutGeometryPresent({
  engineCommandManager,
  unit,
}: {
  engineCommandManager: EngineCommandManager
  unit?: UnitLength_type
}) {
  // If you load an empty scene with any file unit it will have an eye offset of this
  const MAGIC_ENGINE_EYE_OFFSET = 1378.0057
  const quat = computeIsometricQuaternionForEmptyScene()
  const isometricView: CameraViewState_type = {
    pivot_rotation: {
      x: quat.x,
      y: quat.y,
      z: quat.z,
      w: quat.w,
    },
    pivot_position: {
      x: 0,
      y: 0,
      z: 0,
    },
    eye_offset: MAGIC_ENGINE_EYE_OFFSET,
    fov_y: 45,
    ortho_scale_factor: 1.4063792,
    is_ortho: true,
    ortho_scale_enabled: true,
    world_coord_system: 'right_handed_up_z',
  }
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_set_view',
      view: {
        ...isometricView,
      },
    },
  })
}
