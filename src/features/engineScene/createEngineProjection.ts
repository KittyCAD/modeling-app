import { type ReadonlySignal, computed, effect, signal } from '@preact/signals'
import { decode as msgpackDecode } from '@msgpack/msgpack'
import type { EngineConnection } from '@src/contracts/engine'
import type { ScenePoint } from '@src/contracts/scene'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import {
  type CameraFrame,
  type PlaneFrame,
  type PlanePoint,
  type Vector3,
  type ViewportSize,
  pixelsPerUnit,
  projectPoint,
  unprojectToPlane,
} from '@src/lib/scene/projection'

/**
 * The camera responses worth listening to.
 *
 * Every one of these answers with the settings the camera ended up at, which is
 * how the app follows a camera it does not own. `camera_drag_move` is the one
 * that matters while a drag is happening; the rest are how the overlay catches
 * up after a zoom, a fit, or a named view.
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
        data?: {
          settings?: EngineCameraSettings
          origin?: Vector3
          x_axis?: Vector3
          y_axis?: Vector3
          z_axis?: Vector3
        }
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

/**
 * Where things are, for the streamed engine.
 *
 * Built on the one fact that makes an overlay possible over a remote renderer:
 * the engine reports its camera. Nothing here drives the camera or asks it to
 * hold still — it listens to the answers the camera driver's own commands
 * already produce, so orbiting stays available while a sketch is open and the
 * overlay simply moves with it.
 *
 * The cost is honesty about latency: the overlay is as fresh as the last echo,
 * which is the same 15 Hz the driver sends drags at. Overlay and video therefore
 * lag the pointer *together*, which reads as a heavy camera rather than as two
 * things sliding apart. The existing app takes the opposite trade — it owns the
 * camera in sketch mode and pushes positions — and gets an overlay that leads
 * the video instead.
 */
export function createEngineProjection(
  /** Lazy: resolving a service while the registry graph is built is not allowed. */
  getConnection: () => EngineConnection
): SceneProjection & { dispose: () => void } {
  const camera = signal<CameraFrame | null>(null)
  const epoch = signal(0)

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

      const next = cameraFrom(response.data?.settings)
      if (!next) return

      camera.value = next
      epoch.value += 1
    })

    /*
     * Ask once per scene, so there is a camera before anything is dragged.
     *
     * Without this the overlay would stay blank until the user happened to
     * orbit — the engine volunteers nothing, and a fresh scene is exactly when
     * somebody is most likely to open a sketch and expect to see it.
     */
    stopSeeding = effect(() => {
      void connection.sceneEpoch.value
      if (connection.state.value.status !== 'connected') return

      void connection
        .sendCommand({ type: 'default_camera_get_settings' })
        .then((bytes) => {
          const next = cameraFrom(modelingResponse(bytes)?.data?.settings)
          if (!next) return
          camera.value = next
          epoch.value += 1
        })
        .catch(() => {
          // A scene that went away before it answered. The next drag will say
          // where the camera is.
        })
    })
  })

  return {
    id: 'engine',
    ready: computed(() => camera.value !== null) as ReadonlySignal<boolean>,
    epoch: computed(() => epoch.value),

    project(point: Vector3, viewport: ViewportSize) {
      const current = camera.peek()
      return current ? projectPoint(current, point, viewport) : null
    },

    unproject(at: ScenePoint, plane: PlaneFrame) {
      const current = camera.peek()
      return current ? unprojectToPlane(current, at, at.viewport, plane) : null
    },

    scaleOn(plane: PlaneFrame, near: PlanePoint, viewport: ViewportSize) {
      const current = camera.peek()
      return current ? pixelsPerUnit(current, plane, near, viewport) : 0
    },

    /**
     * Where a face is, asked of the engine.
     *
     * Sketch mode is enabled and immediately disabled, with the camera left
     * alone, because `get_sketch_mode_plane` is the only command that reports a
     * face's frame and it only answers while sketch mode is on. The existing app
     * does exactly this for the same reason. It is three round trips for one
     * answer, which is why it happens once when a sketch is opened rather than
     * whenever something is drawn.
     */
    async frameOf(entityId: string) {
      const connection = getConnection()
      if (connection.state.peek().status !== 'connected') return null

      try {
        await connection.sendCommand({
          type: 'enable_sketch_mode',
          entity_id: entityId,
          adjust_camera: false,
          animated: false,
          ortho: false,
        })

        const bytes = await connection.sendCommand({
          type: 'get_sketch_mode_plane',
        })

        const response = modelingResponse(bytes)
        const data =
          response?.type === 'get_sketch_mode_plane' ? response.data : undefined

        return data?.origin && data.x_axis && data.y_axis && data.z_axis
          ? {
              origin: data.origin,
              xAxis: data.x_axis,
              yAxis: data.y_axis,
              zAxis: data.z_axis,
            }
          : null
      } catch {
        // Not something the engine can put a plane on. Asking is how we find
        // out, and "no" is an answer.
        return null
      } finally {
        /*
         * Always leave. Sketch mode hides everything but the sketched-on face,
         * so a failure that left it on would look like the model had vanished.
         */
        connection.fireCommand({ type: 'sketch_mode_disable' })
      }
    },

    dispose() {
      stopListening?.()
      stopSeeding()
    },
  }
}
