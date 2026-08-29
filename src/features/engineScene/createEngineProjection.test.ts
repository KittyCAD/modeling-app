import { encode as msgpackEncode } from '@msgpack/msgpack'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEngineCamera } from '@src/features/engineScene/createEngineCamera'
import { createEngineProjection } from '@src/features/engineScene/createEngineProjection'
import {
  createFakeConnection,
  settle,
} from '@src/features/engineScene/fakeConnection'
import type { PlaneFrame } from '@src/lib/scene/projection'

const xy: PlaneFrame = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
}

const viewport = { width: 800, height: 400 }

describe('createEngineProjection', () => {
  let fake: ReturnType<typeof createFakeConnection>
  let camera: ReturnType<typeof createEngineCamera>
  let projection: ReturnType<typeof createEngineProjection>

  beforeEach(() => {
    fake = createFakeConnection()
    camera = createEngineCamera(() => fake.connection)
    projection = createEngineProjection(() => fake.connection, camera)
  })

  it('places nothing until the camera has been heard from', async () => {
    const offline = createFakeConnection()
    offline.status.value = 'connecting'
    const quiet = createEngineCamera(() => offline.connection)
    const waiting = createEngineProjection(() => offline.connection, quiet)
    await settle()

    expect(waiting.ready.value).toBe(false)
    expect(waiting.project({ x: 0, y: 0, z: 0 }, viewport)).toBeNull()
    expect(waiting.orientationOf({ x: 1, y: 0, z: 0 })).toBeNull()
    quiet.dispose()
  })

  it('puts the look-at centre in the middle of the viewport', async () => {
    await settle()

    expect(projection.ready.value).toBe(true)
    expect(projection.project({ x: 0, y: 0, z: 0 }, viewport)).toEqual({
      x: 400,
      y: 200,
    })
  })

  it('unprojects a click onto the sketch plane', async () => {
    await settle()

    const point = projection.unproject({ x: 400, y: 200, viewport }, xy)
    expect(point?.x).toBeCloseTo(0)
    expect(point?.y).toBeCloseTo(0)
  })

  it('says which way a world direction points, for the gizmo', async () => {
    await settle()

    // Looking down at the origin: +X is to the right and lies in the screen.
    const seen = projection.orientationOf({ x: 1, y: 0, z: 0 })
    expect(seen?.x).toBeCloseTo(1)
    expect(seen?.depth).toBeCloseTo(0)
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
