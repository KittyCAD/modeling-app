import { computed, effect, signal } from '@preact/signals'
import { decode as msgpackDecode } from '@msgpack/msgpack'
import type { ReadonlySignal } from '@preact/signals'
import type { EngineConnection } from '@src/contracts/engine'
import type { CameraFrame, Vector3 } from '@src/lib/scene/projection'

/**
 * Where the engine's camera is, by listening to it.
 *
 * The one fact that makes an overlay, a gizmo and an animated view change
 * possible over a renderer in another process: every camera drag, zoom and fit
 * answers with the settings the camera ended up at. So the app can know where
 * the camera is without owning it — which is what keeps orbiting available
 * inside a sketch, and what lets a view change interpolate from wherever the
 * user happened to leave it.
 *
 * Shared, because there are two consumers with nothing else in common: the
 * projection places things on screen, and the camera driver needs somewhere to
 * animate *from*. Two listeners would be two subscriptions to the same messages
 * and two ideas of the current camera, which is one more than there should be.
 */

/**
 * The camera responses worth listening to.
 *
 * `camera_drag_move` is the one that matters while a drag is happening; the rest
 * are how a listener catches up after a zoom, a fit, or a named view.
 */
const CAMERA_RESPONSES = new Set([
  'camera_drag_move',
  'camera_drag_end',
  'default_camera_zoom',
  'default_camera_get_settings',
  'zoom_to_fit',
  'view_isometric',
  'default_camera_look_at',
])

/** The engine's own camera payload, before it is given a shape. */
interface EngineCameraSettings {
  pos?: Vector3
  center?: Vector3
  up?: Vector3
  /**
   * The camera's rotation. The only reported value that carries roll.
   *
   * Without it a trackball orbit is invisible to everything drawn over the
   * scene: an up *hint* is enough to rebuild an orientation only while the
   * camera stays level.
   */
  orientation?: { x: number; y: number; z: number; w: number }
  fov_y?: number | null
  ortho?: boolean
}

interface EngineMessage {
  resp?: {
    data?: {
      modeling_response?: {
        type?: string
        data?: { settings?: EngineCameraSettings }
      }
    }
  }
}

/**
 * The field of view to assume when the engine reports none.
 *
 * It omits one in orthographic mode, where its own view height is still derived
 * from a field of view — the last perspective one. This is the value the camera
 * driver sends when it sets perspective, so the two agree.
 */
const DEFAULT_FOV_Y = 45

const modelingResponse = (bytes: Uint8Array) =>
  (msgpackDecode(bytes) as EngineMessage).resp?.data?.modeling_response

/** The camera in the app's terms, or null for a payload that is not one. */
function cameraFrom(
  settings: EngineCameraSettings | undefined
): CameraFrame | null {
  if (!settings?.pos || !settings.center || !settings.up) return null

  return {
    position: settings.pos,
    target: settings.center,
    up: settings.up,
    ...(settings.orientation ? { orientation: settings.orientation } : {}),
    fovY: settings.fov_y ?? DEFAULT_FOV_Y,
    orthographic: settings.ortho ?? false,
  }
}

export interface EngineCamera {
  /** Null until the engine has said where its camera is. */
  readonly frame: ReadonlySignal<CameraFrame | null>
  /** Bumps whenever the view changed, for whoever redraws rather than reads. */
  readonly epoch: ReadonlySignal<number>
  /**
   * Whether the app is moving the camera rather than following it.
   *
   * Read by the driver, which has to send something different in each case: a
   * drag becomes a camera command when the engine owns the camera, and local
   * arithmetic when we do.
   */
  readonly owned: ReadonlySignal<boolean>
  /**
   * Take the camera.
   *
   * Adopts wherever the engine last reported and stops listening, so nothing
   * moves at the moment of the claim. From here the app is the authority and the
   * engine is told afterwards — which is what makes an overlay answer the pointer
   * immediately, and why the *video* is the thing that lags while a sketch is
   * open.
   */
  claim: () => void
  /** Hand it back, and start following the engine again. */
  release: () => void
  /**
   * Move the camera, while it is ours.
   *
   * A function of the current frame rather than a new frame, so a caller cannot
   * move a camera it has a stale copy of — every gesture composes on whatever the
   * last one produced. Ignored when the camera is not claimed: a renderer that
   * owns its own camera is not something to be steered from here.
   */
  steer: (move: (frame: CameraFrame) => CameraFrame) => void
  dispose: () => void
}

/**
 * How often a claimed camera tells the engine where it is.
 *
 * The same 15 Hz as a drag, and for the same reason: each report costs the engine
 * a re-render and a re-stream, so sending every local change would build a queue
 * that runs behind itself. The existing app throttles this exact command to the
 * same rate.
 */
const PUSH_INTERVAL_MS = 1000 / 15

export function createEngineCamera(
  /** Lazy: resolving a service while the registry graph is built is not allowed. */
  getConnection: () => EngineConnection
): EngineCamera {
  const frame = signal<CameraFrame | null>(null)
  const epoch = signal(0)
  const owned = signal(false)

  const record = (next: CameraFrame | null) => {
    if (!next) return
    /*
     * Ignored while the camera is ours.
     *
     * Our own pushes come back as echoes, so applying them would feed a
     * fifteen-Hz round trip into the value the pointer is driving — the camera
     * would stutter between where it has been moved to and where the engine last
     * confirmed it was.
     */
    if (owned.peek()) return

    frame.value = next
    epoch.value += 1
  }

  /** The last local frame the engine has not been told about yet. */
  let unsent: CameraFrame | null = null
  let pushTimer: number | undefined

  const push = () => {
    pushTimer = undefined
    const next = unsent
    unsent = null
    if (!next) return

    getConnection().fireCommand({
      type: 'default_camera_look_at',
      center: next.target,
      vantage: next.position,
      up: next.up,
    })
  }

  let stopListening: (() => void) | null = null
  let stopSeeding = () => {}

  queueMicrotask(() => {
    const connection = getConnection()

    stopListening = connection.onUnmatchedResponse((bytes) => {
      let response
      try {
        response = modelingResponse(bytes)
      } catch {
        // Not a message this can read. The connection hands every unmatched
        // response to every listener, so most of them are somebody else's.
        return
      }

      if (!response?.type || !CAMERA_RESPONSES.has(response.type)) return
      record(cameraFrom(response.data?.settings))
    })

    /*
     * Ask once per scene, so there is a camera before anything is dragged.
     *
     * Without this nothing would know where the camera is until the user
     * happened to orbit — and a fresh scene is exactly when somebody is most
     * likely to open a sketch or square up a view and expect it to work.
     */
    stopSeeding = effect(() => {
      void connection.sceneEpoch.value
      if (connection.state.value.status !== 'connected') return

      void connection
        .sendCommand({ type: 'default_camera_get_settings' })
        .then((bytes) =>
          record(cameraFrom(modelingResponse(bytes)?.data?.settings))
        )
        .catch(() => {
          // A scene that went away before it answered. The next drag will say
          // where the camera is.
        })
    })
  })

  return {
    frame: computed(() => frame.value),
    epoch: computed(() => epoch.value),
    owned: computed(() => owned.value),

    claim() {
      // Nothing to take authority over yet. Claiming a camera we have never
      // heard of would start everything from a guess.
      if (frame.peek() === null) return
      owned.value = true
    },

    release() {
      owned.value = false

      /*
       * Send whatever the throttle was still holding.
       *
       * A release lands between pushes more often than not — the last thing
       * somebody does before leaving a sketch is move the view — and dropping
       * that frame would ask the engine where its camera is while it is still a
       * fifteenth of a second behind, which comes back as the view jumping to
       * where it was rather than staying where it was left.
       */
      if (pushTimer !== undefined) window.clearTimeout(pushTimer)
      push()

      /*
       * Ask where the engine is, rather than assuming it is where we left it.
       *
       * It should be — we pushed — but a dropped command or a scene restarted
       * underneath us would otherwise leave the app following a camera position
       * that only it believes in, and the next echo would arrive as a jump.
       */
      const connection = getConnection()
      if (connection.state.peek().status !== 'connected') return
      void connection
        .sendCommand({ type: 'default_camera_get_settings' })
        .then((bytes) =>
          record(cameraFrom(modelingResponse(bytes)?.data?.settings))
        )
        .catch(() => {
          // The next drag will say where the camera is.
        })
    },

    steer(move) {
      if (!owned.peek()) return
      const current = frame.peek()
      if (!current) return

      const next = move(current)
      frame.value = next
      epoch.value += 1

      // Told at the drag rate, on a trailing edge so the last position of a
      // gesture is always the one the engine ends up at.
      unsent = next
      if (pushTimer === undefined) {
        pushTimer = window.setTimeout(push, PUSH_INTERVAL_MS)
      }
    },

    dispose() {
      stopListening?.()
      stopSeeding()
      if (pushTimer !== undefined) window.clearTimeout(pushTimer)
    },
  }
}
