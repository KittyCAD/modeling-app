import { type ReadonlySignal, computed, effect } from '@preact/signals'
import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import type { EngineConnection } from '@src/contracts/engine'
import type {
  CameraDriver,
  CameraGesture,
  CameraZoomRequest,
  ScenePoint,
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

  /** Element pixels to the engine's pixels. */
  const toStreamWindow = (at: ScenePoint) => {
    if (at.viewport.width === 0 || at.viewport.height === 0) {
      return { x: 0, y: 0 }
    }
    const stream = getConnection().viewportSize.peek()
    return {
      x: Math.round((at.x / at.viewport.width) * stream.width),
      y: Math.round((at.y / at.viewport.height) * stream.height),
    }
  }

  const commandFor = (gesture: CameraGesture) => ({
    type:
      gesture.phase === 'start'
        ? 'camera_drag_start'
        : gesture.phase === 'move'
          ? 'camera_drag_move'
          : 'camera_drag_end',
    interaction: gesture.kind,
    window: toStreamWindow(gesture.at),
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
