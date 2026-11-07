import { expect, it, vi } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createLegacyGizmoCamera } from '@src/components/gizmo/legacyCamera'
import { Signal } from '@src/lib/signal'

function createScene() {
  const scene: Parameters<typeof createLegacyGizmoCamera>[0] = {
    animate: vi.fn(),
    stop: vi.fn(),
    camControls: {
      camera: new PerspectiveCamera(),
      cameraChange: new Signal(),
      target: new Vector3(1, 2, 3),
      syncDirection: 'engineToClient',
      enableRotate: true,
      wasDragging: false,
      tweenCameraToQuaternion: vi.fn(async () => {}),
      rotateCamera: vi.fn(),
      safeLookAtTarget: vi.fn(),
      onCameraChange: vi.fn(),
    },
  }
  return scene
}

it('observes only the bound scene and returns independent orientation snapshots', () => {
  const scene = createScene()
  const camera = createLegacyGizmoCamera(scene)
  const snapshot = camera.getOrientation()
  snapshot.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)
  expect(camera.getOrientation().equals(new Quaternion())).toBe(true)

  const listener = vi.fn()
  const unsubscribe = camera.subscribeOrientation(listener)
  createScene().camControls.cameraChange.dispatch()
  expect(listener).not.toHaveBeenCalled()
  scene.camControls.cameraChange.dispatch()
  expect(listener).toHaveBeenCalledTimes(1)
  unsubscribe()
  scene.camControls.cameraChange.dispatch()
  expect(listener).toHaveBeenCalledTimes(1)
})

it.each([false, true])(
  'restores camera synchronization after orientation (failure: %s)',
  async (fail) => {
    const scene = createScene()
    const camera = createLegacyGizmoCamera(scene)
    const orientation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI
    )
    const completion = Promise.withResolvers<undefined>()
    vi.mocked(scene.camControls.tweenCameraToQuaternion).mockReturnValue(
      completion.promise
    )

    const operation = camera.orientTo(orientation)
    expect(scene.camControls.syncDirection).toBe('clientToEngine')
    expect(scene.camControls.enableRotate).toBe(false)
    expect(scene.animate).toHaveBeenCalledTimes(1)
    expect(scene.camControls.tweenCameraToQuaternion).toHaveBeenCalledWith(
      orientation,
      scene.camControls.target,
      500
    )
    expect(
      vi.mocked(scene.camControls.tweenCameraToQuaternion).mock.calls[0][1]
    ).not.toBe(scene.camControls.target)

    if (fail) {
      const error = new Error('Camera update failed')
      completion.reject(error)
      await expect(operation).rejects.toBe(error)
    } else {
      completion.resolve(undefined)
      await operation
    }
    expect(scene.stop).toHaveBeenCalledTimes(1)
    expect(scene.camControls.syncDirection).toBe('engineToClient')
    expect(scene.camControls.enableRotate).toBe(true)
  }
)

it('keeps orbit changes on its bound scene', () => {
  const scene = createScene()
  const other = createScene()
  const camera = createLegacyGizmoCamera(scene)
  camera.beginOrbit()
  expect(scene.camControls.wasDragging).toBe(true)
  camera.orbitBy(12, -4)
  expect(scene.camControls.rotateCamera).toHaveBeenCalledWith(12, -4)
  expect(scene.camControls.safeLookAtTarget).toHaveBeenCalledTimes(1)
  expect(scene.camControls.onCameraChange).toHaveBeenCalledWith(true)
  expect(other.camControls.rotateCamera).not.toHaveBeenCalled()
  camera.endOrbit()
  expect(scene.camControls.wasDragging).toBe(false)
})
