import { computed, signal } from '@preact/signals'
import { encode as msgpackEncode } from '@msgpack/msgpack'
import type {
  EngineConnection,
  EngineConnectionState,
  SceneCommand,
} from '@src/contracts/engine'

/** A camera 100mm above the origin, looking down, as the engine reports one. */
export const OVERHEAD = {
  pos: { x: 0, y: 0, z: 100 },
  center: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fov_y: 45,
  ortho: false,
}

export const cameraResponse = (type: string, settings: unknown) =>
  msgpackEncode({
    request_id: 'whoever',
    resp: { data: { modeling_response: { type, data: { settings } } } },
  }).slice()

/** The engine, as much of it as the camera and the projection can tell apart. */
export function createFakeConnection() {
  const status = signal<EngineConnectionState['status']>('connected')
  const epoch = signal(0)
  const sent: SceneCommand[] = []
  const listeners = new Set<(bytes: Uint8Array) => void>()
  let answer: (cmd: SceneCommand) => Uint8Array | Promise<Uint8Array> = () =>
    cameraResponse('default_camera_get_settings', OVERHEAD)

  const connection = {
    state: computed(() => ({
      status: status.value,
      stage: null,
      error: null,
      pingMs: null,
      apiCallId: null,
    })),
    sceneEpoch: computed(() => epoch.value),
    viewportSize: computed(() => ({ width: 800, height: 400 })),
    fireCommand: (cmd: SceneCommand) => {
      sent.push(cmd)
    },
    sendCommand: async (cmd: SceneCommand) => {
      sent.push(cmd)
      return answer(cmd)
    },
    onUnmatchedResponse: (listener: (bytes: Uint8Array) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as unknown as EngineConnection

  return {
    connection,
    sent,
    status,
    epoch,
    deliver: (bytes: Uint8Array) => {
      for (const listener of listeners) listener(bytes)
    },
    respondWith: (next: typeof answer) => {
      answer = next
    },
  }
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
