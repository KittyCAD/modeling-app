import { beforeEach, describe, expect, it } from 'vitest'
import { encode as msgpackEncode } from '@msgpack/msgpack'
import { createEngineCamera } from '@src/features/engineScene/createEngineCamera'
import {
  OVERHEAD,
  cameraResponse,
  createFakeConnection,
  settle,
} from '@src/features/engineScene/fakeConnection'

describe('createEngineCamera', () => {
  let fake: ReturnType<typeof createFakeConnection>

  beforeEach(() => {
    fake = createFakeConnection()
  })

  it('knows nothing until the engine has said where its camera is', async () => {
    fake.status.value = 'connecting'
    const camera = createEngineCamera(() => fake.connection)
    await settle()

    expect(camera.frame.value).toBeNull()
    camera.dispose()
  })

  it('asks once a scene exists, so nothing has to wait for a drag', async () => {
    const camera = createEngineCamera(() => fake.connection)
    await settle()

    expect(fake.sent).toContainEqual({ type: 'default_camera_get_settings' })
    expect(camera.frame.value?.position).toEqual({ x: 0, y: 0, z: 100 })
    camera.dispose()
  })

  it('follows the camera without owning it', async () => {
    const camera = createEngineCamera(() => fake.connection)
    await settle()
    const before = camera.epoch.value

    // What a drag produces: the engine moved its own camera and says where it
    // ended up. Nothing here told it to.
    fake.deliver(
      cameraResponse('camera_drag_move', {
        ...OVERHEAD,
        center: { x: 10, y: 0, z: 0 },
        pos: { x: 10, y: 0, z: 100 },
      })
    )

    expect(camera.epoch.value).toBe(before + 1)
    expect(camera.frame.value?.target).toEqual({ x: 10, y: 0, z: 0 })
    camera.dispose()
  })

  it('ignores responses that are not about the camera', async () => {
    const camera = createEngineCamera(() => fake.connection)
    await settle()
    const before = camera.epoch.value

    fake.deliver(
      msgpackEncode({
        resp: { data: { modeling_response: { type: 'select_with_point' } } },
      }).slice()
    )
    // Unmatched responses go to every listener, so most of them are other
    // people's traffic — including bytes this cannot decode at all.
    fake.deliver(new Uint8Array([0xc1]))

    expect(camera.epoch.value).toBe(before)
    camera.dispose()
  })

  it('assumes a field of view when the engine reports none', async () => {
    const camera = createEngineCamera(() => fake.connection)
    await settle()

    fake.deliver(
      cameraResponse('camera_drag_end', {
        ...OVERHEAD,
        fov_y: null,
        ortho: true,
      })
    )

    // The engine omits one in ortho and still derives its view height from the
    // last perspective one, which is the value the driver sends.
    expect(camera.frame.value?.fovY).toBe(45)
    camera.dispose()
  })

  it('stops listening when disposed', async () => {
    const camera = createEngineCamera(() => fake.connection)
    await settle()
    const before = camera.epoch.value
    camera.dispose()

    fake.deliver(cameraResponse('camera_drag_move', OVERHEAD))

    expect(camera.epoch.value).toBe(before)
  })
})
