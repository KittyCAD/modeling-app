import { type ReadonlySignal, computed, effect } from '@preact/signals'
import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import type { EngineConnection } from '@src/contracts/engine'
import type { CameraFrame } from '@src/lib/scene/projection'
import type { EngineCamera } from '@src/features/engineScene/createEngineCamera'
import { toStreamWindow } from '@src/features/engineScene/streamWindow'
import {
  type Viewpoint,
  ease,
  tweenViewpoint,
} from '@src/lib/scene/cameraTween'
import { dolly, orbit, pan, trackball } from '@src/lib/scene/cameraMotion'
import { halfViewHeight } from '@src/lib/scene/projection'
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

/** Which way is up when nothing says otherwise. The existing app's default. */
const WORLD_UP = { x: 0, y: 0, z: 1 }

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

  /** Where the last local gesture had the pointer, for the next delta. */
  let lastLocal: { x: number; y: number } | null = null

  /**
   * How much of a wheel notch is a zoom. Tuned against the engine's own feel.
   */
  const ZOOM_SENSITIVITY = 0.15

  /** How much of a vertical drag-zoom pixel is a zoom. */
  const DRAG_ZOOM_SENSITIVITY = 0.01

  /**
   * Move the camera ourselves, from a gesture.
   *
   * Deltas rather than positions, because the arithmetic is about how far the
   * pointer went — while the engine's own drag protocol is about where it *is*,
   * which is why the two paths cannot share a handler.
   */
  const steerLocally = (gesture: CameraGesture) => {
    if (gesture.phase === 'start') {
      lastLocal = { x: gesture.at.x, y: gesture.at.y }
      return
    }

    if (gesture.phase === 'end') {
      lastLocal = null
      return
    }

    const previous = lastLocal
    lastLocal = { x: gesture.at.x, y: gesture.at.y }
    if (!previous) return

    const deltaX = gesture.at.x - previous.x
    const deltaY = gesture.at.y - previous.y

    dependencies.camera.steer((frame) => {
      switch (gesture.kind) {
        case 'rotate':
          return orbit(frame, deltaX, deltaY)
        case 'rotatetrackball':
          return trackball(frame, deltaX, deltaY)
        case 'pan': {
          /*
           * How big a pixel is where the target is, so the model moves exactly as
           * far as the pointer. The viewport is the *element's*, which is what the
           * gesture measured against.
           */
          const height = gesture.at.viewport.height
          const distance = Math.hypot(
            frame.position.x - frame.target.x,
            frame.position.y - frame.target.y,
            frame.position.z - frame.target.z
          )
          const unitsPerPixel =
            height > 0 ? (halfViewHeight(frame, distance) * 2) / height : 0

          return pan(frame, deltaX, deltaY, unitsPerPixel)
        }
        case 'zoom':
          // The engine's drag-zoom is vertical, and so is this.
          return dolly(frame, 1 + deltaY * DRAG_ZOOM_SENSITIVITY)
      }
    })
  }

  /**
   * Put the camera at a distance from a target, along a direction.
   *
   * The one place both `faceOn` and `lookFrom` end up, because they differ only
   * in where the target and the direction come from.
   *
   * The distance is kept when we know it — and we do, because the camera reports
   * itself, so a view change can alter the direction and the centre and leave
   * the zoom alone. That is what somebody squaring up to a face wants, and it
   * avoids a fit: on a file whose only content is an empty sketch there is
   * nothing to fit to. A fit is the fallback for a camera we have never heard
   * from, which is also the case with nothing to animate from.
   */
  const moveTo = (target: Point, direction: Point, up: Point) => {
    cancelTween()
    const from = dependencies.camera.frame.peek()

    const distance = from
      ? Math.hypot(
          from.position.x - from.target.x,
          from.position.y - from.target.y,
          from.position.z - from.target.z
        ) || DISTANCE
      : DISTANCE

    const to: Viewpoint = {
      target,
      position: {
        x: target.x + direction.x * distance,
        y: target.y + direction.y * distance,
        z: target.z + direction.z * distance,
      },
      up,
    }

    if (!from) {
      settle(to)
      sendZoomToFit()
      return
    }

    if (dependencies.reducedMotion()) {
      settle(to)
      return
    }

    tweenTo({ position: from.position, target: from.target, up: from.up }, to)
  }

  /**
   * Arrive at a viewpoint, by whichever route the camera belongs to.
   *
   * A claimed camera has to be *moved*, not merely told: sending the engine a
   * look-at while the app is the authority would move the video and leave every
   * overlay behind, until the next gesture snapped them back together.
   */
  const settle = (to: Viewpoint) => {
    if (dependencies.camera.owned.peek()) {
      dependencies.camera.steer(() => ({
        ...(dependencies.camera.frame.peek() as CameraFrame),
        position: to.position,
        target: to.target,
        up: to.up,
        orientation: undefined,
      }))
      return
    }

    sendLookAt(to)
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
        settle(to)
        return
      }

      settle(tweenViewpoint(from, to, ease(progress)))
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

      /*
       * A claimed camera moves here, not on the engine.
       *
       * While the app owns the camera — which is what happens when a sketch is
       * open — a drag is arithmetic rather than a message: the frame changes now,
       * everything drawn from it follows this frame, and the engine is told at
       * the same 15 Hz a drag would have used. The overlay therefore answers the
       * pointer and the video is the thing that lags, which is the trade the
       * existing app makes for the same reason.
       */
      if (dependencies.camera.owned.peek()) {
        steerLocally(gesture)
        return
      }

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

      if (dependencies.camera.owned.peek()) {
        // Positive zooms in, so it shortens the distance.
        dependencies.camera.steer((frame) =>
          dolly(frame, 1 - request.magnitude * ZOOM_SENSITIVITY)
        )
        return
      }
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

      const normal = unit(plane.zAxis)
      // The plane's own up, so the sketch's Y is the screen's Y. Anything else
      // would draw a horizontal constraint at an angle.
      moveTo(plane.origin, normal, unit(plane.yAxis))
    },

    lookFrom(direction, up) {
      if (!ready.peek()) return

      const from = dependencies.camera.frame.peek()
      // What you are already looking at, which is the point: a corner of the
      // gizmo means "from over there", not "somewhere else in the model".
      const target = from?.target ?? { x: 0, y: 0, z: 0 }

      moveTo(target, unit(direction), up ? unit(up) : WORLD_UP)
    },

    zoomToFit() {
      if (!ready.peek()) return
      cancelTween()
      sendZoomToFit()
    },

    claimCamera() {
      cancelTween()
      dependencies.camera.claim()
    },

    releaseCamera() {
      cancelTween()
      lastLocal = null
      dependencies.camera.release()
    },

    setProjection(next) {
      projection = next
      if (!ready.peek()) return
      sendProjection(next)

      /*
       * And onto the frame, when the frame is ours.
       *
       * A claimed camera ignores the engine's echoes, so this is the only way the
       * change reaches whatever is drawn over the video — without it, switching
       * projection during a sketch would draw the sketch in perspective over an
       * orthographic render.
       */
      dependencies.camera.steer((frame) => ({
        ...frame,
        orthographic: next === 'orthographic',
      }))
    },

    dispose: () => {
      cancelTween()
      stopRestating()
      cancelPending()
    },
  }
}
