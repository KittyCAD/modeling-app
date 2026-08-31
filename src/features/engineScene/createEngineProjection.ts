import { decode as msgpackDecode } from '@msgpack/msgpack'
import { computed } from '@preact/signals'
import type { EngineConnection } from '@src/contracts/engine'
import type { ScenePoint } from '@src/contracts/scene'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type { EngineCamera } from '@src/features/engineScene/createEngineCamera'
import {
  type PlaneFrame,
  type PlanePoint,
  pixelsPerUnit,
  projectPoint,
  unprojectToPlane,
  type Vector3,
  type ViewportSize,
  viewDirection,
} from '@src/lib/scene/projection'

interface EngineMessage {
  resp?: {
    data?: {
      modeling_response?: {
        type?: string
        data?: {
          origin?: Vector3
          x_axis?: Vector3
          y_axis?: Vector3
          z_axis?: Vector3
        }
      }
    }
  }
}

const modelingResponse = (bytes: Uint8Array) =>
  (msgpackDecode(bytes) as EngineMessage).resp?.data?.modeling_response

/**
 * Where things are, for the streamed engine.
 *
 * All of the arithmetic is pure and lives in `src/lib/scene/projection`; all of
 * the *knowing where the camera is* is in `createEngineCamera`, which listens to
 * the engine rather than driving it. What is left here is the join between them,
 * plus the one question only a round trip can answer: where a face is.
 *
 * The cost of following the camera by echo is honesty about latency: everything
 * placed here is as fresh as the last report, which is the same 15 Hz the driver
 * sends drags at. Overlay and video therefore lag the pointer *together*, which
 * reads as a heavy camera rather than as two things sliding apart. The existing
 * app takes the opposite trade — it owns the camera in sketch mode and pushes
 * positions — and gets an overlay that leads the video instead.
 */
export function createEngineProjection(
  /** Lazy: resolving a service while the registry graph is built is not allowed. */
  getConnection: () => EngineConnection,
  camera: EngineCamera
): SceneProjection {
  return {
    id: 'engine',
    ready: computed(() => camera.frame.value !== null),
    epoch: camera.epoch,
    frame: camera.frame,

    orientationOf(direction: Vector3) {
      const current = camera.frame.peek()
      return current ? viewDirection(current, direction) : null
    },

    project(point: Vector3, viewport: ViewportSize) {
      const current = camera.frame.peek()
      return current ? projectPoint(current, point, viewport) : null
    },

    unproject(at: ScenePoint, plane: PlaneFrame) {
      const current = camera.frame.peek()
      return current ? unprojectToPlane(current, at, at.viewport, plane) : null
    },

    scaleOn(plane: PlaneFrame, near: PlanePoint, viewport: ViewportSize) {
      const current = camera.frame.peek()
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
  }
}
