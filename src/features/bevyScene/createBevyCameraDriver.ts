import { computed, signal } from '@preact/signals'
import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import type {
  CameraDriver,
  CameraGesture,
  CameraZoomRequest,
  ScenePoint,
  StandardView,
} from '@src/contracts/scene'
import type { BevyModule } from '@src/features/bevyScene/loadBevy'
import type { PlaneFrame, Vector3 } from '@src/lib/scene/projection'

/**
 * Where each named view stands, and which way is up when it gets there.
 *
 * Zoo's frame: Z-up, millimetres. Copied from the streamed engine's driver
 * (`createEngineCameraDriver`'s `VANTAGES`) rather than derived, because "front"
 * is a convention this application already has and two renderers disagreeing
 * about it would be worse than either choice.
 *
 * Directions, not positions: the distance is whatever the camera already had.
 */
const VANTAGES: Record<StandardView, { direction: Vector3; up: Vector3 }> = {
  top: { direction: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
  bottom: { direction: { x: 0, y: 0, z: -1 }, up: { x: 0, y: -1, z: 0 } },
  front: { direction: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  back: { direction: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  right: { direction: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  left: { direction: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  /** Front, right and above, which is the three-quarter this app resets to. */
  isometric: { direction: { x: 1, y: -1, z: 1 }, up: { x: 0, y: 0, z: 1 } },
}

/**
 * How much of a zoom one pixel of a zoom-drag is worth.
 *
 * A drag has no natural scale the way a wheel click does, so this is chosen to
 * feel like the wheel over a gesture of a few hundred pixels.
 */
const DRAG_ZOOM_PER_PIXEL = 0.01

/**
 * The camera, for bevy-zoo.
 *
 * Everything renderer-independent — which button and modifier mean orbit, pointer
 * capture, touch, the preferences — happened before this is called; see
 * `features/camera`. What is left is the part that is peculiar to a renderer in
 * this process, and it is mostly the absence of things the streamed engine needs:
 *
 * - no rate limit. The engine charges a re-render and a re-stream per message, so
 *   its driver throttles to 15 Hz. This one is a function call into wasm, so every
 *   pointer event can be delivered and the camera tracks the pointer exactly.
 * - no second pixel space. The canvas is the size of the element, so the
 *   `ScenePoint` viewport travels straight through as the surface size.
 * - no restating. The Bevy app does not forget its scene, so a projection set
 *   once stays set.
 */
export function createBevyCameraDriver(options: {
  /** Resolves once the module is running; camera calls before that are dropped. */
  module: Promise<BevyModule>
}): CameraDriver & { dispose: () => void } {
  let bevy: BevyModule | null = null
  const attached = signal(false)
  let disposed = false

  void options.module.then((module) => {
    if (disposed) return
    bevy = module
    attached.value = true
  })

  /**
   * Where the last move was, per gesture kind.
   *
   * The recogniser reports positions and this renderer wants deltas — it applies
   * them to a camera it owns rather than sending an absolute look-at. Kept per
   * kind so a pan and an orbit cannot be confused for one another if both are
   * somehow live.
   */
  const previous = new Map<CameraGesture['kind'], ScenePoint>()

  const deltaFor = (gesture: CameraGesture) => {
    const last = previous.get(gesture.kind)
    previous.set(gesture.kind, gesture.at)
    if (!last) return null
    return { x: gesture.at.x - last.x, y: gesture.at.y - last.y }
  }

  return {
    id: 'bevy',
    ready: computed(() => attached.value),

    gesture(gesture) {
      if (gesture.phase === 'start') {
        previous.set(gesture.kind, gesture.at)
        return
      }
      if (gesture.phase === 'end') {
        previous.delete(gesture.kind)
        return
      }
      const delta = deltaFor(gesture)
      if (!bevy || !delta) return

      const { width, height } = gesture.at.viewport
      switch (gesture.kind) {
        case 'rotate':
          bevy.camera_orbit(delta.x, delta.y, width, height, false)
          break
        case 'rotatetrackball':
          bevy.camera_orbit(delta.x, delta.y, width, height, true)
          break
        case 'pan':
          bevy.camera_pan(delta.x, delta.y, width, height)
          break
        case 'zoom':
          // Dragging down zooms out, which is the direction the wheel uses.
          bevy.camera_zoom(-delta.y * DRAG_ZOOM_PER_PIXEL)
          break
      }
    },

    zoom(request: CameraZoomRequest) {
      bevy?.camera_zoom(request.magnitude)
    },

    setProjection(projection: CameraProjectionType) {
      bevy?.camera_set_projection(projection)
    },

    standardView(view: StandardView) {
      const { direction, up } = VANTAGES[view]
      // One call, then frame it: the contract asks for the direction and the
      // framing together, and here neither costs a round trip.
      bevy?.camera_look_from(
        direction.x,
        direction.y,
        direction.z,
        up.x,
        up.y,
        up.z,
        true
      )
      bevy?.camera_zoom_to_fit()
    },

    lookFrom(direction: Vector3, up?: Vector3) {
      bevy?.camera_look_from(
        direction.x,
        direction.y,
        direction.z,
        up?.x ?? 0,
        up?.y ?? 0,
        up?.z ?? 0,
        up !== undefined
      )
    },

    faceOn(plane: PlaneFrame) {
      bevy?.camera_face_on(
        plane.origin.x,
        plane.origin.y,
        plane.origin.z,
        plane.zAxis.x,
        plane.zAxis.y,
        plane.zAxis.z,
        plane.yAxis.x,
        plane.yAxis.y,
        plane.yAxis.z
      )
    },

    zoomToFit() {
      bevy?.camera_zoom_to_fit()
    },

    /**
     * Both no-ops, which the contract states is the right answer here: the
     * claim exists so a remote renderer can stop round-tripping the camera and
     * move it locally instead. This camera is already local.
     */
    claimCamera() {},
    releaseCamera() {},

    dispose() {
      disposed = true
      previous.clear()
      bevy = null
      attached.value = false
    },
  }
}
