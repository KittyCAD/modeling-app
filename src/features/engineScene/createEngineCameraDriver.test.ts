import { computed, signal } from '@preact/signals'
import type {
  EngineConnection,
  EngineConnectionState,
  SceneCommand,
} from '@src/contracts/engine'
import type { CameraGesture, ScenePoint } from '@src/contracts/scene'
import type { EngineCamera } from '@src/features/engineScene/createEngineCamera'
import { createEngineCameraDriver } from '@src/features/engineScene/createEngineCameraDriver'
import type { CameraFrame } from '@src/lib/scene/projection'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A camera the driver can animate from, or none at all.
 *
 * The distinction matters: with no reported camera there is nothing to
 * interpolate, so a view change states its destination instead.
 */
function fakeCamera(
  frame: CameraFrame | null = null,
  options: { owned?: boolean } = {}
): EngineCamera & { steer: ReturnType<typeof vi.fn> } {
  const value = signal(frame)
  const owned = signal(options.owned ?? false)

  const steer = vi.fn((move: (current: CameraFrame) => CameraFrame) => {
    const current = value.peek()
    if (current) value.value = move(current)
  })

  return {
    frame: computed(() => value.value),
    epoch: computed(() => 0),
    owned: computed(() => owned.value),
    claim: () => {
      owned.value = true
    },
    release: () => {
      owned.value = false
    },
    steer,
    dispose: () => {},
  }
}

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
    driver = createEngineCameraDriver(() => fake.connection, {
      camera: fakeCamera(),
      reducedMotion: () => true,
    })
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

describe('looking straight at a plane', () => {
  /** The XY plane, as the artifact graph reports one. */
  const xy = {
    origin: { x: 0, y: 0, z: 0 },
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 },
  }

  it('looks along the normal, with the plane’s own up', () => {
    const fake = createFakeConnection()
    const driver = createEngineCameraDriver(() => fake.connection, {
      camera: fakeCamera(),
      reducedMotion: () => true,
    })

    driver.faceOn(xy)

    expect(fake.sent[0]).toMatchObject({
      type: 'default_camera_look_at',
      center: { x: 0, y: 0, z: 0 },
      vantage: { x: 0, y: 0, z: 1000 },
      // The sketch's Y is the screen's Y, or a horizontal constraint would be
      // drawn at an angle.
      up: { x: 0, y: 1, z: 0 },
    })
    // Direction and roll only; the framing is a fit, as with the named views.
    expect(fake.sent[1]).toMatchObject({ type: 'zoom_to_fit' })
  })

  it('looks from the plane’s own origin, not the world’s', () => {
    const fake = createFakeConnection()
    const driver = createEngineCameraDriver(() => fake.connection, {
      camera: fakeCamera(),
      reducedMotion: () => true,
    })

    // A sketch on the face of a swept solid: somewhere else, facing sideways.
    driver.faceOn({
      origin: { x: 5, y: 10, z: 20 },
      xAxis: { x: 0, y: 1, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 1, y: 0, z: 0 },
    })

    expect(fake.sent[0]).toMatchObject({
      center: { x: 5, y: 10, z: 20 },
      vantage: { x: 1005, y: 10, z: 20 },
      up: { x: 0, y: 0, z: 1 },
    })
  })

  it('normalises axes it was given unnormalised', () => {
    const fake = createFakeConnection()
    const driver = createEngineCameraDriver(() => fake.connection, {
      camera: fakeCamera(),
      reducedMotion: () => true,
    })

    // An axis is a direction. A frame whose axes are not unit length must not
    // put the camera further away than it was asked to be.
    driver.faceOn({ ...xy, zAxis: { x: 0, y: 0, z: 4 } })

    expect(fake.sent[0]).toMatchObject({ vantage: { x: 0, y: 0, z: 1000 } })
  })

  it('drops the request when there is nothing rendering', () => {
    const fake = createFakeConnection()
    fake.status.value = 'offline'
    const driver = createEngineCameraDriver(() => fake.connection, {
      camera: fakeCamera(),
      reducedMotion: () => true,
    })

    driver.faceOn(xy)

    expect(fake.sent).toEqual([])
  })
})

describe('animating a view change', () => {
  /** A camera 200mm out along -Y, as the engine would report one. */
  const looking = {
    position: { x: 0, y: -200, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    fovY: 45,
    orthographic: false,
  }

  const xy = {
    origin: { x: 0, y: 0, z: 0 },
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 },
  }

  const setup = (reduced: boolean) => {
    const fake = createFakeConnection()
    const driver = createEngineCameraDriver(() => fake.connection, {
      camera: fakeCamera(looking),
      reducedMotion: () => reduced,
    })
    return { fake, driver }
  }

  it('keeps the distance it had, rather than fitting', () => {
    const { fake, driver } = setup(true)

    driver.faceOn(xy)

    // The camera reports itself, so squaring up to a plane can leave the zoom
    // alone — and a fit on a file whose only content is an empty sketch has
    // nothing to fit to.
    expect(fake.sent).toEqual([
      {
        type: 'default_camera_look_at',
        center: { x: 0, y: 0, z: 0 },
        vantage: { x: 0, y: 0, z: 200 },
        up: { x: 0, y: 1, z: 0 },
      },
    ])
  })

  it('goes straight there when animation is limited', () => {
    const { fake, driver } = setup(true)

    driver.faceOn(xy)

    expect(fake.sent).toHaveLength(1)
  })

  it('swings round when it is not', () => {
    vi.useFakeTimers()
    const { fake, driver } = setup(false)

    driver.faceOn(xy)
    // Nothing yet: the first step lands on the first interval, not on the call.
    expect(fake.sent).toHaveLength(0)

    vi.advanceTimersByTime(400)

    expect(fake.sent.length).toBeGreaterThan(2)
    for (const command of fake.sent) {
      expect(command.type).toBe('default_camera_look_at')
    }
    vi.useRealTimers()
  })

  it('arrives exactly, not merely nearby', () => {
    vi.useFakeTimers()
    const { fake, driver } = setup(false)

    driver.faceOn(xy)
    vi.advanceTimersByTime(1000)

    // The point of the move is the destination; the last interpolated step is
    // not it.
    expect(fake.sent.at(-1)).toMatchObject({
      vantage: { x: 0, y: 0, z: 200 },
      up: { x: 0, y: 1, z: 0 },
    })
    vi.useRealTimers()
  })

  it('keeps its distance from the target the whole way round', () => {
    vi.useFakeTimers()
    const { fake, driver } = setup(false)

    driver.faceOn(xy)
    vi.advanceTimersByTime(400)

    // A lerp of the two positions would cut the corner, dragging the camera
    // through whatever is at the target.
    for (const command of fake.sent) {
      const vantage = (
        command as unknown as {
          vantage: { x: number; y: number; z: number }
        }
      ).vantage
      expect(Math.hypot(vantage.x, vantage.y, vantage.z)).toBeCloseTo(200)
    }
    vi.useRealTimers()
  })

  it('stops animating the moment the user touches the camera', () => {
    vi.useFakeTimers()
    const { fake, driver } = setup(false)

    driver.faceOn(xy)
    vi.advanceTimersByTime(80)
    const partWay = fake.sent.length
    driver.gesture({
      kind: 'rotate',
      phase: 'start',
      at: { x: 0, y: 0, viewport: { width: 500, height: 250 } },
    })
    vi.advanceTimersByTime(1000)

    // Only the drag start after the animation was cancelled: a tween that kept
    // sending look-at commands would fight the orbit.
    expect(fake.sent.length).toBe(partWay + 1)
    expect(fake.sent.at(-1)?.type).toBe('camera_drag_start')
    vi.useRealTimers()
  })

  it('states the destination and fits when it has never heard a camera', () => {
    const fake = createFakeConnection()
    const driver = createEngineCameraDriver(() => fake.connection, {
      camera: fakeCamera(null),
      reducedMotion: () => false,
    })

    driver.faceOn(xy)

    // Nothing to interpolate from, and no distance to keep.
    expect(fake.sent.map((command) => command.type)).toEqual([
      'default_camera_look_at',
      'zoom_to_fit',
    ])
  })
})

describe('driving a claimed camera', () => {
  /** A camera 100mm above the origin, looking down. */
  const overhead: CameraFrame = {
    position: { x: 0, y: 0, z: 100 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    fovY: 45,
    orthographic: false,
  }

  const setup = () => {
    const fake = createFakeConnection()
    const camera = fakeCamera(overhead)
    const driver = createEngineCameraDriver(() => fake.connection, {
      camera,
      reducedMotion: () => true,
    })
    return { fake, camera, driver }
  }

  const drag = (
    driver: ReturnType<typeof createEngineCameraDriver>,
    kind: CameraGesture['kind'],
    from: ScenePoint,
    to: ScenePoint
  ) => {
    driver.gesture({ kind, phase: 'start', at: from })
    driver.gesture({ kind, phase: 'move', at: to })
    driver.gesture({ kind, phase: 'end', at: to })
  }

  it('asks for the camera, and gives it back', () => {
    const { camera, driver } = setup()

    driver.claimCamera()
    expect(camera.owned.value).toBe(true)

    driver.releaseCamera()
    expect(camera.owned.value).toBe(false)
  })

  it('orbits with arithmetic instead of a drag command', () => {
    const { fake, camera, driver } = setup()
    driver.claimCamera()

    drag(driver, 'rotate', at(100, 100), at(130, 100))

    // No camera_drag_* at all: while the app owns the camera a drag is a change
    // to the frame, and the engine hears about the result rather than the drag.
    expect(fake.sent).toHaveLength(0)
    expect(camera.steer).toHaveBeenCalledTimes(1)
    // Turned about the vertical, keeping its distance.
    const moved = camera.frame.value as CameraFrame
    expect(
      Math.hypot(moved.position.x, moved.position.y, moved.position.z)
    ).toBeCloseTo(100)
    expect(moved.position.z).toBeLessThan(100)
  })

  it('moves by how far the pointer went, not by where it is', () => {
    const { camera, driver } = setup()
    driver.claimCamera()

    // Two moves of ten pixels each, and then one of twenty from a fresh press:
    // the same total, so the same camera.
    drag(driver, 'rotate', at(0, 0), at(10, 0))
    driver.gesture({ kind: 'rotate', phase: 'start', at: at(0, 0) })
    driver.gesture({ kind: 'rotate', phase: 'move', at: at(10, 0) })
    const twice = camera.frame.value as CameraFrame

    const second = setup()
    second.driver.claimCamera()
    drag(second.driver, 'rotate', at(0, 0), at(20, 0))
    const once = second.camera.frame.value as CameraFrame

    expect(twice.position.x).toBeCloseTo(once.position.x)
    expect(twice.position.y).toBeCloseTo(once.position.y)
  })

  it('pans the model exactly as far as the pointer', () => {
    const { camera, driver } = setup()
    driver.claimCamera()

    // A quarter of the 250px element, on a camera whose view is 2 * 100 *
    // tan(22.5°) tall.
    drag(driver, 'pan', at(0, 0), at(0, 62.5))

    const height = 2 * 100 * Math.tan((22.5 * Math.PI) / 180)
    const moved = camera.frame.value as CameraFrame
    // Dragging down brings the model down, which moves the camera up.
    expect(moved.target.y).toBeCloseTo(height / 4)
    // And the camera keeps its distance: a pan is not a zoom.
    expect(moved.position.z).toBe(100)
  })

  it('zooms the frame rather than asking the engine to', () => {
    const { fake, camera, driver } = setup()
    driver.claimCamera()

    driver.zoom({ magnitude: 1, at: at(250, 125) })

    expect(fake.sent).toHaveLength(0)
    // Positive zooms in, so the camera comes closer.
    expect((camera.frame.value as CameraFrame).position.z).toBeLessThan(100)
  })

  it('steers a view change instead of sending one', () => {
    const { fake, camera, driver } = setup()
    driver.claimCamera()

    driver.faceOn({
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 0, y: -1, z: 0 },
    })

    /*
     * A look-at here would move the video and leave every overlay behind, since
     * the app is the authority and ignores the echo — so the frame has to be the
     * thing that changes.
     */
    expect(fake.sent).toHaveLength(0)
    expect((camera.frame.value as CameraFrame).position).toEqual({
      x: 0,
      y: -100,
      z: 0,
    })
  })

  it('carries a projection change onto the frame it owns', () => {
    const { camera, driver } = setup()
    driver.claimCamera()

    driver.setProjection('orthographic')

    // The echo is ignored while the camera is ours, so without this the sketch
    // would be drawn in perspective over an orthographic render.
    expect((camera.frame.value as CameraFrame).orthographic).toBe(true)
  })

  it('leaves the engine in charge when it has not claimed anything', () => {
    const { fake, camera, driver } = setup()

    drag(driver, 'rotate', at(100, 100), at(130, 100))

    expect(camera.steer).not.toHaveBeenCalled()
    expect(fake.sent.map((cmd) => cmd.type)).toEqual([
      'camera_drag_start',
      'camera_drag_move',
      'camera_drag_end',
    ])
  })
})
