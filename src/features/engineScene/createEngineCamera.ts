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
    fovY: settings.fov_y ?? DEFAULT_FOV_Y,
    orthographic: settings.ortho ?? false,
  }
}

export interface EngineCamera {
  /** Null until the engine has said where its camera is. */
  readonly frame: ReadonlySignal<CameraFrame | null>
  /** Bumps whenever the view changed, for whoever redraws rather than reads. */
  readonly epoch: ReadonlySignal<number>
  dispose: () => void
}

export function createEngineCamera(
  /** Lazy: resolving a service while the registry graph is built is not allowed. */
  getConnection: () => EngineConnection
): EngineCamera {
  const frame = signal<CameraFrame | null>(null)
  const epoch = signal(0)

  const record = (next: CameraFrame | null) => {
    if (!next) return
    frame.value = next
    epoch.value += 1
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
    dispose() {
      stopListening?.()
      stopSeeding()
    },
  }
}
