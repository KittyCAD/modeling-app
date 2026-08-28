import { computed, signal } from '@preact/signals'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EngineConnection,
  EngineConnectionState,
  SceneCommand,
} from '@src/contracts/engine'
import type { CameraGesture, ScenePoint } from '@src/contracts/scene'
import { createEngineCameraDriver } from '@src/features/engineScene/createEngineCameraDriver'

function createFakeConnection() {
  const status = signal<EngineConnectionState['status']>('connected')
  const epoch = signal(0)
  const sent: SceneCommand[] = []

  const connection = {
    state: computed(() => ({
      status: status.value,
      stage: null,
      error: null,
      pingMs: 12,
      apiCallId: null,
    })),
    sceneEpoch: computed(() => epoch.value),
    viewportSize: computed(() => ({ width: 1000, height: 500 })),
    fireCommand: (cmd: SceneCommand) => {
      sent.push(cmd)
    },
  } as unknown as EngineConnection

  return { connection, sent, status, epoch }
}

/** A point on a 500x250 element, as the recogniser would report it. */
const at = (x: number, y: number): ScenePoint => ({
  x,
  y,
  viewport: { width: 500, height: 250 },
})

const gesture = (
  phase: CameraGesture['phase'],
  point: ScenePoint = at(0, 0)
): CameraGesture => ({ kind: 'rotate', phase, at: point })

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createEngineCameraDriver', () => {
  let fake: ReturnType<typeof createFakeConnection>
  let driver: ReturnType<typeof createEngineCameraDriver>

  beforeEach(() => {
    fake = createFakeConnection()
    driver = createEngineCameraDriver(() => fake.connection)
  })

  it('maps element pixels onto the engine’s pixels', () => {
    // The engine renders at a size it was asked for, rounded to its own
    // granularity, which is almost never the size of the panel — so the middle
    // of the element has to arrive as the middle of the frame.
    driver.gesture(gesture('start', at(250, 125)))

    expect(fake.sent).toEqual([
      {
        type: 'camera_drag_start',
        interaction: 'rotate',
        window: { x: 500, y: 250 },
      },
    ])
  })

  it('survives a point measured before layout', () => {
    driver.gesture(
      gesture('start', { x: 10, y: 10, viewport: { width: 0, height: 0 } })
    )
    expect(fake.sent[0].window).toEqual({ x: 0, y: 0 })
  })

  it('rate-limits moves, and still reports the last position', () => {
    vi.useFakeTimers()
    driver.gesture(gesture('start', at(0, 0)))
    driver.gesture(gesture('move', at(10, 0)))
    driver.gesture(gesture('move', at(20, 0)))
    driver.gesture(gesture('move', at(40, 0)))

    const moves = () =>
      fake.sent.filter((cmd) => cmd.type === 'camera_drag_move')
    // Each move costs the engine a re-render and a re-stream.
    expect(moves()).toHaveLength(1)

    vi.advanceTimersByTime(100)
    expect(moves()).toHaveLength(2)
    expect(moves()[1].window).toEqual({ x: 80, y: 0 })
    vi.useRealTimers()
  })

  it('never delays the end of a drag behind a queued move', () => {
    vi.useFakeTimers()
    driver.gesture(gesture('start'))
    driver.gesture(gesture('move', at(10, 0)))
    driver.gesture(gesture('move', at(20, 0)))
    driver.gesture(gesture('end', at(30, 0)))

    // A move waiting its turn must not arrive after the end and leave the
    // engine believing the drag is still running.
    expect(fake.sent.at(-1)?.type).toBe('camera_drag_end')
    vi.advanceTimersByTime(200)
    expect(fake.sent.at(-1)?.type).toBe('camera_drag_end')
    vi.useRealTimers()
  })

  it('zooms', () => {
    driver.zoom({ magnitude: -20, at: at(0, 0) })
    expect(fake.sent).toEqual([{ type: 'default_camera_zoom', magnitude: -20 }])
  })

  it('states the projection, with a field of view for perspective', () => {
    driver.setProjection('orthographic')
    expect(fake.sent.at(-1)).toEqual({
      type: 'default_camera_set_orthographic',
    })

    driver.setProjection('perspective')
    expect(fake.sent.at(-1)).toEqual({
      type: 'default_camera_set_perspective',
      parameters: { fov_y: 45 },
    })
  })

  it('restates the projection when the engine starts a fresh scene', async () => {
    driver.setProjection('perspective')
    await settle()
    fake.sent.length = 0

    fake.epoch.value += 1
    // The engine begins each scene at its own defaults, and only the driver
    // knows that happened — so restating is its job, not the camera's.
    expect(fake.sent).toEqual([
      {
        type: 'default_camera_set_perspective',
        parameters: { fov_y: 45 },
      },
    ])
  })

  it('says nothing at all while disconnected', () => {
    fake.status.value = 'offline'
    driver.gesture(gesture('start'))
    driver.zoom({ magnitude: 1, at: at(0, 0) })
    driver.setProjection('perspective')

    expect(fake.sent).toEqual([])
    expect(driver.ready.value).toBe(false)
  })

  it('states the projection it was given once there is a connection', async () => {
    fake.status.value = 'offline'
    driver.setProjection('perspective')
    await settle()

    fake.status.value = 'connected'
    fake.epoch.value += 1

    // The preference was set before anything was listening; it is not lost.
    expect(fake.sent.at(-1)).toEqual({
      type: 'default_camera_set_perspective',
      parameters: { fov_y: 45 },
    })
  })

  describe('named views', () => {
    it('looks along the axis, then frames what is there', () => {
      driver.standardView('front')

      expect(fake.sent).toEqual([
        {
          type: 'default_camera_look_at',
          center: { x: 0, y: 0, z: 0 },
          // Front is looking from -Y, with Z up.
          vantage: { x: 0, y: -1000, z: 0 },
          up: { x: 0, y: 0, z: 1 },
        },
        {
          type: 'zoom_to_fit',
          object_ids: [],
          padding: 0.1,
          animated: false,
        },
      ])
    })

    it('puts up along Y for the two views down Z, where Z is degenerate', () => {
      driver.standardView('top')
      driver.standardView('bottom')

      const looks = fake.sent.filter(
        (cmd) => cmd.type === 'default_camera_look_at'
      )

      expect(looks[0]).toMatchObject({
        vantage: { x: 0, y: 0, z: 1000 },
        up: { x: 0, y: 1, z: 0 },
      })
      // Flipped, or the part reads mirrored from underneath.
      expect(looks[1]).toMatchObject({
        vantage: { x: 0, y: 0, z: -1000 },
        up: { x: 0, y: -1, z: 0 },
      })
    })

    it('asks the engine for its own isometric', () => {
      driver.standardView('isometric')

      // One command, not a look-at and a fit: `view_isometric` already frames,
      // and it leaves the projection alone.
      expect(fake.sent).toEqual([{ type: 'view_isometric', padding: 0.1 }])
    })

    it('fits on its own', () => {
      driver.zoomToFit()
      expect(fake.sent).toEqual([
        { type: 'zoom_to_fit', object_ids: [], padding: 0.1, animated: false },
      ])
    })

    it('says nothing while there is no connection', () => {
      fake.status.value = 'offline'

      driver.standardView('top')
      driver.zoomToFit()

      expect(fake.sent).toEqual([])
    })
  })
})
