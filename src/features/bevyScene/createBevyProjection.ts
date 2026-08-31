import { computed } from '@preact/signals'
import type { ScenePoint } from '@src/contracts/scene'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import { bevyCamera, bevyCameraEpoch } from '@src/features/bevyScene/loadBevy'
import type {
  PlaneFrame,
  PlanePoint,
  Vector3,
  ViewportSize,
} from '@src/lib/scene/projection'
import {
  pixelsPerUnit,
  projectPoint,
  unprojectToPlane,
  viewDirection,
} from '@src/lib/scene/projection'

/**
 * Where things are on screen, for bevy-zoo.
 *
 * Almost entirely the shared arithmetic in `lib/scene/projection`, which is the
 * point of that module: the projection is a function of a `CameraFrame`, and a
 * renderer's only real job is to say what its camera is. The streamed engine
 * answers by listening to what it is told; this answers from a camera in this
 * process, so it is exact rather than one echo behind.
 *
 * The camera it reads carries the camera's *actual* up vector rather than world
 * up, which is what makes this correct under a trackball orbit — a basis built
 * from world up stays level while the model rolls underneath it.
 */
export function createBevyProjection(): SceneProjection {
  const frame = computed(() => bevyCamera.value)

  return {
    id: 'bevy',
    ready: computed(() => bevyCamera.value !== null),
    epoch: computed(() => bevyCameraEpoch.value),
    frame,

    orientationOf(direction: Vector3) {
      const camera = bevyCamera.value
      return camera ? viewDirection(camera, direction) : null
    },

    project(point: Vector3, viewport: ViewportSize) {
      const camera = bevyCamera.value
      return camera ? projectPoint(camera, point, viewport) : null
    },

    unproject(at: ScenePoint, plane: PlaneFrame) {
      const camera = bevyCamera.value
      return camera ? unprojectToPlane(camera, at, at.viewport, plane) : null
    },

    scaleOn(plane: PlaneFrame, near: PlanePoint, viewport: ViewportSize) {
      const camera = bevyCamera.value
      return camera ? pixelsPerUnit(camera, plane, near, viewport) : 0
    },

    /**
     * Always null, and that is the honest answer rather than a stub.
     *
     * A face's frame is something only the geometry kernel worked out, and asking
     * is a round trip through the engine's picking — which this renderer does not
     * have. Null is the documented answer for an entity the renderer cannot
     * place, and it is why sketching on a face is unavailable here rather than
     * subtly wrong.
     */
    frameOf() {
      return Promise.resolve(null)
    },
  }
}
