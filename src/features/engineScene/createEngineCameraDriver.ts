import { type ReadonlySignal, computed, effect } from '@preact/signals'
import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import type { EngineConnection } from '@src/contracts/engine'
import type { EngineCamera } from '@src/features/engineScene/createEngineCamera'
import { toStreamWindow } from '@src/features/engineScene/streamWindow'
import {
  type Viewpoint,
  ease,
  tweenViewpoint,
} from '@src/lib/scene/cameraTween'
import type {
  CameraDriver,
  CameraGesture,
  CameraZoomRequest,
  ScenePoint,
  StandardView,
} from '@src/contracts/scene'

/**
 * How often a drag reports while the pointer is moving.
 *
 * This is the engine's number, not the camera's. The scene is rendered remotely,
 * so each move costs a re-render *and* a re-stream; sending every pointer event
 * buys nothing a viewer can see and costs a queue that runs behind the pointer.
 * A renderer in this process would want every frame instead, which is exactly
 * why the limit lives here rather than in the gesture recogniser.
 */
const MOVE_INTERVAL_MS = 1000 / 15

/**
 * How far out a named view starts from.
 *
 * Nominal — a fit follows immediately — so this only has to be outside whatever
 * is being modelled rather than related to it.
 */
const DISTANCE = 1000

/** Space left around the model by a fit. The existing app's number. */
const FIT_PADDING = 0.1

/**
 * How long a view change takes.
 *
 * Short, because the cadence is 15 Hz: a third of a second is five frames, and
 * anything longer at this rate stops reading as motion and starts reading as a
 * slideshow. What the animation buys is not smoothness but *continuity* — you
 * can see which way the model turned, which is the thing a jump cut loses.
 */
const TWEEN_DURATION_MS = 340

interface Point {
  x: number
  y: number
  z: number
}

/**
 * A direction of length one.
 *
 * The engine is given directions, not distances, so a plane frame whose axes
 * happen not to be normalised must not turn into a camera further away than it
 * was asked to be. A zero vector stays zero; there is no direction to invent.
 */
function unit(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (length === 0) return vector
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  }
}

/**
 * The camera driver for the streamed engine.
 *
 * Three things make this engine-specific, and all three would be wrong for a
 * local renderer: the command envelope, the pixel space, and the rate limit.
 *
 * The pixel space is the subtle one. The engine renders at a size it was asked
 * for — clamped into its own bounds and rounded to a multiple of four — which is
 * almost never the size of the panel. So a click at the middle of the element has
 * to arrive as the middle of the *frame*, and the mapping needs both sizes.
 */
export interface EngineCameraDriverDependencies {
  /** Where the engine's camera is, so a view change can be animated *from* it. */
  camera: EngineCamera
  /**
   * Whether to skip the animation and go straight to the result.
   *
   * Read per move rather than captured, so turning the preference on takes
   * effect on the next view change instead of on the next connection.
   */
  reducedMotion: () => boolean
}

export function createEngineCameraDriver(
  /** Lazy: resolving a service while the registry graph is built is not allowed. */
  getConnection: () => EngineConnection,
  dependencies: EngineCameraDriverDependencies
): CameraDriver & { dispose: () => void } {
  const ready: ReadonlySignal<boolean> = computed(
    () => getConnection().state.value.status === 'connected'
  )

  let lastSentAt: number | null = null
  let pending: CameraGesture | null = null
  let timer: number | undefined
  let projection: CameraProjectionType | null = null
  let tweenTimer: number | undefined

  /**
   * Stop any view change that is part way through.
   *
   * Anything that moves the camera cancels it, and that is the whole of the
   * conflict resolution: a user who starts orbiting during an animation has said
   * something more recent than the animation did, and an animation that kept
   * sending look-at commands underneath them would fight the drag.
   */
  const cancelTween = () => {
    if (tweenTimer !== undefined) window.clearInterval(tweenTimer)
    tweenTimer = undefined
  }

  const sendLookAt = (at: Viewpoint) => {
    getConnection().fireCommand({
      type: 'default_camera_look_at',
      center: at.target,
      vantage: at.position,
      up: at.up,
    })
  }

  /**
   * Swing the camera from where it is to where it was asked to be.
   *
   * At the same 15 Hz everything else is sent at, and for the same reason: each
   * step costs a re-render and a re-stream, so a smoother tween would only build
   * a queue that runs behind itself. Six or seven frames is what the stream can
   * show of a third of a second, which is why the duration is short — a long
   * animation at this cadence reads as stuttering rather than as motion.
   */
  const tweenTo = (from: Viewpoint, to: Viewpoint) => {
    cancelTween()
    const startedAt = performance.now()

    tweenTimer = window.setInterval(() => {
      const progress = (performance.now() - startedAt) / TWEEN_DURATION_MS

      if (progress >= 1) {
        cancelTween()
        // Sent exactly, rather than as the last interpolated step: the point of
        // the move is the destination, and arriving near it is not arriving.
        sendLookAt(to)
        return
      }

      sendLookAt(tweenViewpoint(from, to, ease(progress)))
    }, MOVE_INTERVAL_MS)
  }

  /** Element pixels to the engine's pixels. Shared with the picker. */
  const windowFor = (at: ScenePoint) =>
    toStreamWindow(at, getConnection().viewportSize.peek())

  const commandFor = (gesture: CameraGesture) => ({
    type:
      gesture.phase === 'start'
        ? 'camera_drag_start'
        : gesture.phase === 'move'
          ? 'camera_drag_move'
          : 'camera_drag_end',
    interaction: gesture.kind,
    window: windowFor(gesture.at),
  })

  const flush = () => {
    timer = undefined
    if (!pending) return
    lastSentAt = performance.now()
    getConnection().fireCommand(commandFor(pending))
    pending = null
  }

  const cancelPending = () => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
    pending = null
  }

  /**
   * Restate the projection whenever the engine starts a fresh scene.
   *
   * The renderer's amnesia is the renderer's problem to solve. Only the driver
   * knows the engine begins each scene at its own defaults, so the camera
   * feature states the preference once and this keeps it true.
   */
  let stopRestating = () => {}
  queueMicrotask(() => {
    stopRestating = effect(() => {
      void getConnection().sceneEpoch.value
      const wanted = projection
      if (!ready.value || !wanted) return
      sendProjection(wanted)
    })
  })

  function sendProjection(next: CameraProjectionType) {
    getConnection().fireCommand(
      next === 'orthographic'
        ? { type: 'default_camera_set_orthographic' }
        : {
            type: 'default_camera_set_perspective',
            // The engine wants a field of view with the perspective camera; 45
            // degrees is what the existing app uses.
            parameters: { fov_y: 45 },
          }
    )
  }

  /**
   * Where to look from, for each named view.
   *
   * The distance is nominal: `zoom_to_fit` follows every one of these and moves
   * the camera along the direction it was given, so what these fix is the
   * *direction* and which way is up. Far enough out that the fit does not have to
   * start from inside the geometry.
   *
   * Up is Z for the side views, and Y for the two along Z, where Z would be
   * degenerate. Bottom flips it so the part does not read mirrored.
   */
  const VANTAGES: Record<
    Exclude<StandardView, 'isometric'>,
    { vantage: Point; up: Point }
  > = {
    top: { vantage: { x: 0, y: 0, z: DISTANCE }, up: { x: 0, y: 1, z: 0 } },
    bottom: {
      vantage: { x: 0, y: 0, z: -DISTANCE },
      up: { x: 0, y: -1, z: 0 },
    },
    front: { vantage: { x: 0, y: -DISTANCE, z: 0 }, up: { x: 0, y: 0, z: 1 } },
    back: { vantage: { x: 0, y: DISTANCE, z: 0 }, up: { x: 0, y: 0, z: 1 } },
    right: { vantage: { x: DISTANCE, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
    left: { vantage: { x: -DISTANCE, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  }

  const sendZoomToFit = () => {
    getConnection().fireCommand({
      type: 'zoom_to_fit',
      // Empty is everything. The padding is the existing app's number.
      object_ids: [],
      padding: FIT_PADDING,
      animated: false,
    })
  }

  return {
    id: 'engine',
    ready,

    gesture(gesture) {
      if (!ready.peek()) return
      // The user is more recent than the animation.
      cancelTween()

      if (gesture.phase === 'move') {
        pending = gesture
        // Explicitly unbounded for the first move of a drag rather than relying
        // on the clock having started long ago, which is only true outside a test.
        const since =
          lastSentAt === null
            ? Number.POSITIVE_INFINITY
            : performance.now() - lastSentAt
        if (since >= MOVE_INTERVAL_MS) {
          flush()
        } else if (timer === undefined) {
          // Trailing edge, so the gesture ends where the pointer actually is
          // rather than wherever the last interval happened to land.
          timer = window.setTimeout(flush, MOVE_INTERVAL_MS - since)
        }
        return
      }

      // A start or an end is never delayed, and neither is held up behind a
      // move that was waiting its turn.
      cancelPending()
      if (gesture.phase === 'start') lastSentAt = null
      getConnection().fireCommand(commandFor(gesture))
    },

    zoom(request: CameraZoomRequest) {
      if (!ready.peek()) return
      cancelTween()
      getConnection().fireCommand({
        type: 'default_camera_zoom',
        magnitude: request.magnitude,
      })
    },

    standardView(view) {
      if (!ready.peek()) return
      cancelTween()

      if (view === 'isometric') {
        // The engine's own isometric, which is safe under either projection: it
        // changes the direction and not the lens.
        getConnection().fireCommand({
          type: 'view_isometric',
          padding: FIT_PADDING,
        })
        return
      }

      const { vantage, up } = VANTAGES[view]
      getConnection().fireCommand({
        type: 'default_camera_look_at',
        center: { x: 0, y: 0, z: 0 },
        vantage,
        up,
      })
      // Then frame it. The existing app instead keeps a mirror of the camera in
      // the client so it can preserve the current distance and target; that
      // needs `default_camera_get_settings` and a decoded reply, and a fit is a
      // better answer than a preserved distance for a view someone asked for by
      // name.
      sendZoomToFit()
    },

    faceOn(plane) {
      if (!ready.peek()) return
      cancelTween()

      const normal = unit(plane.zAxis)
      const origin = plane.origin
      const from = dependencies.camera.frame.peek()

      /*
       * The distance is kept when we know it.
       *
       * Because we do: the camera reports itself, so looking at a plane can
       * change the direction and the centre and leave the zoom alone — which is
       * what somebody squaring up to a face wants, and it avoids a fit. A fit is
       * the fallback for a camera we have never heard from, and on a file whose
       * only content is an empty sketch there is nothing to fit to.
       */
      const distance = from
        ? Math.hypot(
            from.position.x - from.target.x,
            from.position.y - from.target.y,
            from.position.z - from.target.z
          ) || DISTANCE
        : DISTANCE

      const to: Viewpoint = {
        target: origin,
        position: {
          x: origin.x + normal.x * distance,
          y: origin.y + normal.y * distance,
          z: origin.z + normal.z * distance,
        },
        // The plane's own up, so the sketch's Y is the screen's Y. Anything else
        // would draw a horizontal constraint at an angle.
        up: unit(plane.yAxis),
      }

      if (!from) {
        // Nothing to move from, so there is nothing to animate: state the
        // destination and frame it.
        sendLookAt(to)
        sendZoomToFit()
        return
      }

      if (dependencies.reducedMotion()) {
        sendLookAt(to)
        return
      }

      tweenTo({ position: from.position, target: from.target, up: from.up }, to)
    },

    zoomToFit() {
      if (!ready.peek()) return
      cancelTween()
      sendZoomToFit()
    },

    setProjection(next) {
      projection = next
      if (!ready.peek()) return
      sendProjection(next)
    },

    dispose: () => {
      cancelTween()
      stopRestating()
      cancelPending()
    },
  }
}
