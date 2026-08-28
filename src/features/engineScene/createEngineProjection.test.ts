import { computed, signal } from '@preact/signals'
import { encode as msgpackEncode } from '@msgpack/msgpack'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  EngineConnection,
  EngineConnectionState,
  SceneCommand,
} from '@src/contracts/engine'
import type { PlaneFrame } from '@src/lib/scene/projection'
import { createEngineProjection } from '@src/features/engineScene/createEngineProjection'

/** A camera 100mm above the origin, looking down, as the engine reports one. */
const OVERHEAD = {
  pos: { x: 0, y: 0, z: 100 },
  center: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fov_y: 45,
  ortho: false,
}

const cameraResponse = (type: string, settings: unknown) =>
  msgpackEncode({
    request_id: 'whoever',
    resp: { data: { modeling_response: { type, data: { settings } } } },
  }).slice()

function createFakeConnection() {
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const xy: PlaneFrame = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
}

const viewport = { width: 800, height: 400 }

describe('createEngineProjection', () => {
  let fake: ReturnType<typeof createFakeConnection>
  let projection: ReturnType<typeof createEngineProjection>

  beforeEach(() => {
    fake = createFakeConnection()
    projection = createEngineProjection(() => fake.connection)
  })

  it('cannot place anything until a camera has been heard from', async () => {
    fake.status.value = 'connecting'
    const offline = createEngineProjection(() => fake.connection)
    await settle()

    expect(offline.ready.value).toBe(false)
    expect(offline.project({ x: 0, y: 0, z: 0 }, viewport)).toBeNull()
    offline.dispose()
  })

  it('asks for the camera once a scene exists, so the overlay is not blank', async () => {
    await settle()

    expect(fake.sent).toContainEqual({ type: 'default_camera_get_settings' })
    expect(projection.ready.value).toBe(true)
    expect(projection.project({ x: 0, y: 0, z: 0 }, viewport)).toEqual({
      x: 400,
      y: 200,
    })
  })

  it('follows the camera without owning it', async () => {
    await settle()
    const before = projection.epoch.value

    // What a drag produces: the engine moved its own camera and says where it
    // ended up. Nothing here told it to.
    fake.deliver(
      cameraResponse('camera_drag_move', {
        ...OVERHEAD,
        center: { x: 10, y: 0, z: 0 },
        pos: { x: 10, y: 0, z: 100 },
      })
    )

    expect(projection.epoch.value).toBe(before + 1)
    expect(projection.project({ x: 10, y: 0, z: 0 }, viewport)).toEqual({
      x: 400,
      y: 200,
    })
  })

  it('ignores responses that are not about the camera', async () => {
    await settle()
    const before = projection.epoch.value

    fake.deliver(
      msgpackEncode({
        resp: { data: { modeling_response: { type: 'select_with_point' } } },
      }).slice()
    )
    // Unmatched responses go to every listener, so most of them are other
    // people's traffic.
    fake.deliver(new Uint8Array([0xc1]))

    expect(projection.epoch.value).toBe(before)
  })

  it('unprojects a click onto the sketch plane', async () => {
    await settle()

    const point = projection.unproject({ x: 400, y: 200, viewport }, xy)
    expect(point?.x).toBeCloseTo(0)
    expect(point?.y).toBeCloseTo(0)
  })

  it('asks the engine where a face is, and always leaves sketch mode', async () => {
    await settle()
    fake.sent.length = 0
    fake.respondWith((cmd) =>
      cmd.type === 'get_sketch_mode_plane'
        ? msgpackEncode({
            resp: {
              data: {
                modeling_response: {
                  type: 'get_sketch_mode_plane',
                  data: {
                    origin: { x: 0, y: 0, z: 5 },
                    x_axis: { x: 1, y: 0, z: 0 },
                    y_axis: { x: 0, y: 1, z: 0 },
                    z_axis: { x: 0, y: 0, z: 1 },
                  },
                },
              },
            },
          }).slice()
        : msgpackEncode({}).slice()
    )

    const frame = await projection.frameOf('a-wall')

    expect(frame?.origin).toEqual({ x: 0, y: 0, z: 5 })
    expect(fake.sent.map((cmd) => cmd.type)).toEqual([
      'enable_sketch_mode',
      'get_sketch_mode_plane',
      'sketch_mode_disable',
    ])
  })

  it('leaves sketch mode even when the engine refuses the face', async () => {
    await settle()
    fake.sent.length = 0
    fake.respondWith(() => {
      throw new Error('not a face')
    })

    expect(await projection.frameOf('a-solid')).toBeNull()
    // Sketch mode hides everything else, so being left in it would look like
    // the model had disappeared.
    expect(fake.sent.at(-1)).toEqual({ type: 'sketch_mode_disable' })
  })
})
