import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encode as msgpackEncode } from '@msgpack/msgpack'
import { createEngineCamera } from '@src/features/engineScene/createEngineCamera'
import type { CameraFrame } from '@src/lib/scene/projection'
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

describe('owning the camera', () => {
  let fake: ReturnType<typeof createFakeConnection>

  beforeEach(() => {
    fake = createFakeConnection()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Built with fake timers running, so the seeding round trip still lands. */
  const claimed = async () => {
    const camera = createEngineCamera(() => fake.connection)
    await vi.advanceTimersByTimeAsync(0)
    camera.claim()
    return camera
  }

  const moveRight = (frame: CameraFrame): CameraFrame => ({
    ...frame,
    position: { ...frame.position, x: frame.position.x + 10 },
  })

  it('will not be claimed before there is anything to take', async () => {
    fake.status.value = 'connecting'
    const camera = createEngineCamera(() => fake.connection)
    await vi.advanceTimersByTimeAsync(0)

    camera.claim()

    // Claiming a camera nobody has heard from would start everything from a
    // guess, and the guess would show up as a jump on the first echo.
    expect(camera.owned.value).toBe(false)
    camera.dispose()
  })

  it('moves the frame at once and tells the engine at the drag rate', async () => {
    const camera = await claimed()
    const before = camera.epoch.value

    camera.steer(moveRight)
    camera.steer(moveRight)

    // The frame is the app's now, so the overlay drawn from it is already right.
    expect(camera.frame.value?.position.x).toBe(20)
    expect(camera.epoch.value).toBe(before + 2)
    expect(
      fake.sent.filter((cmd) => cmd.type === 'default_camera_look_at')
    ).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1000 / 15)

    // One command for the pair, carrying where the camera ended up rather than
    // where it passed through.
    expect(
      fake.sent.filter((cmd) => cmd.type === 'default_camera_look_at')
    ).toEqual([
      {
        type: 'default_camera_look_at',
        center: { x: 0, y: 0, z: 0 },
        vantage: { x: 20, y: 0, z: 100 },
        up: { x: 0, y: 1, z: 0 },
      },
    ])
    camera.dispose()
  })

  it('ignores the engine while the camera is ours', async () => {
    const camera = await claimed()
    camera.steer(moveRight)
    const epoch = camera.epoch.value

    // Our own push, coming back. Applying it would feed a 15 Hz round trip into
    // the value the pointer is driving, and the camera would stutter between the
    // two.
    fake.deliver(
      cameraResponse('default_camera_look_at', {
        ...OVERHEAD,
        pos: { x: 10, y: 0, z: 100 },
      })
    )
    fake.deliver(
      cameraResponse('camera_drag_move', {
        ...OVERHEAD,
        pos: { x: 999, y: 0, z: 100 },
      })
    )

    expect(camera.frame.value?.position.x).toBe(10)
    expect(camera.epoch.value).toBe(epoch)
    camera.dispose()
  })

  it('sends the last position on the way out rather than dropping it', async () => {
    const camera = await claimed()
    camera.steer(moveRight)

    // Released between pushes, which is the common case: the last thing somebody
    // does before leaving a sketch is move the view.
    camera.release()

    expect(
      fake.sent.filter((cmd) => cmd.type === 'default_camera_look_at')
    ).toHaveLength(1)
    camera.dispose()
  })

  it('asks the engine where it is once the camera is handed back', async () => {
    const camera = await claimed()
    camera.steer(moveRight)
    fake.sent.length = 0

    camera.release()
    await vi.advanceTimersByTimeAsync(0)

    expect(camera.owned.value).toBe(false)
    expect(fake.sent).toContainEqual({ type: 'default_camera_get_settings' })
    // And what it answers is adopted, rather than the app carrying on from a
    // position only it believes in.
    expect(camera.frame.value?.position).toEqual({ x: 0, y: 0, z: 100 })
    camera.dispose()
  })

  it('does not move a camera it does not own', async () => {
    const camera = createEngineCamera(() => fake.connection)
    await vi.advanceTimersByTimeAsync(0)
    const before = camera.frame.value

    camera.steer(moveRight)
    await vi.advanceTimersByTimeAsync(1000 / 15)

    expect(camera.frame.value).toBe(before)
    expect(
      fake.sent.filter((cmd) => cmd.type === 'default_camera_look_at')
    ).toHaveLength(0)
    camera.dispose()
  })

  it('sends nothing more once disposed mid-gesture', async () => {
    const camera = await claimed()
    camera.steer(moveRight)
    camera.dispose()
    fake.sent.length = 0

    await vi.advanceTimersByTimeAsync(1000 / 15)

    expect(fake.sent).toHaveLength(0)
  })
})
