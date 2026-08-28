import { type ReadonlySignal, computed, effect } from '@preact/signals'
import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import type { EngineConnection } from '@src/contracts/engine'
import { toStreamWindow } from '@src/features/engineScene/streamWindow'
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

interface Point {
  x: number
  y: number
  z: number
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
export function createEngineCameraDriver(
  /** Lazy: resolving a service while the registry graph is built is not allowed. */
  getConnection: () => EngineConnection
): CameraDriver & { dispose: () => void } {
  const ready: ReadonlySignal<boolean> = computed(
    () => getConnection().state.value.status === 'connected'
  )

  let lastSentAt: number | null = null
  let pending: CameraGesture | null = null
  let timer: number | undefined
  let projection: CameraProjectionType | null = null

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
      getConnection().fireCommand({
        type: 'default_camera_zoom',
        magnitude: request.magnitude,
      })
    },

    standardView(view) {
      if (!ready.peek()) return

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

    zoomToFit() {
      if (!ready.peek()) return
      sendZoomToFit()
    },

    setProjection(next) {
      projection = next
      if (!ready.peek()) return
      sendProjection(next)
    },

    dispose: () => {
      stopRestating()
      cancelPending()
    },
  }
}
