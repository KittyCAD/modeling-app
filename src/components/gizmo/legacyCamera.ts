import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { GizmoCamera } from '@src/components/gizmo/camera'

/** The legacy operations used by the camera adapter, independent of the rest of SceneInfra. */
type LegacyGizmoScene = Pick<SceneInfra, 'animate' | 'stop'> & {
  camControls: Pick<
    SceneInfra['camControls'],
    | 'camera'
    | 'cameraChange'
    | 'target'
    | 'syncDirection'
    | 'enableRotate'
    | 'wasDragging'
    | 'tweenCameraToQuaternion'
    | 'rotateCamera'
    | 'safeLookAtTarget'
    | 'onCameraChange'
  >
}

/** Binds the gizmo to a captured legacy scene, even when the active project changes. */
export function createLegacyGizmoCamera(
  sceneInfra: LegacyGizmoScene
): GizmoCamera {
  const controls = sceneInfra.camControls
  return {
    getOrientation: () => controls.camera.quaternion.clone(),
    subscribeOrientation: (listener) => controls.cameraChange.add(listener),
    async orientTo(orientation) {
      controls.syncDirection = 'clientToEngine'
      controls.enableRotate = false
      try {
        sceneInfra.animate()
        await controls.tweenCameraToQuaternion(
          orientation,
          controls.target.clone(),
          500
        )
      } finally {
        sceneInfra.stop()
        controls.enableRotate = true
        controls.syncDirection = 'engineToClient'
      }
    },
    beginOrbit() {
      controls.wasDragging = true
    },
    orbitBy(dx, dy) {
      controls.rotateCamera(dx, dy)
      controls.safeLookAtTarget()
      controls.onCameraChange(true)
    },
    endOrbit() {
      controls.wasDragging = false
    },
  }
}
