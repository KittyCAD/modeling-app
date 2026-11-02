import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { Signal } from '@src/lib/signal'
import {
  Box3,
  Euler,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'
import {
  DriverSpaceMouseController,
  type SpaceMouseCameraControls,
} from './driverSpaceMouse'
import { SpaceMouseController, spaceMouseState } from './spaceMouseController'
import vendorSource from '@public/vendor/3dconnexion.min.js?raw'

vi.mock('/vendor/3dconnexion.min.js?url', () => ({
  default: '/vendor/3dconnexion.min.js',
}))

class FakeDriver {
  static instances: FakeDriver[] = []
  connect = vi.fn(() => 1)
  create3dmouse = vi.fn()
  update3dcontroller = vi.fn()
  delete3dmouse = vi.fn()
  close = vi.fn()
  _3dcontroller = 1
  session = {
    call: vi.fn(
      (
        _procedure: string,
        _instance: string,
        _properties: unknown
      ): Promise<unknown> => Promise.resolve()
    ),
  }

  constructor(readonly client: DriverSpaceMouseController) {
    FakeDriver.instances.push(this)
  }
}

function setup(
  camera: PerspectiveCamera | OrthographicCamera = new PerspectiveCamera(
    45,
    1.6,
    0.1,
    1000
  )
) {
  camera.position.set(0, 0, 100)
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const cameraChange = new Signal()
  const controls: SpaceMouseCameraControls = {
    camera,
    target: new Vector3(),
    domElement: canvas,
    localCameraMode: true,
    enableRotate: true,
    enablePan: true,
    enableZoom: true,
    isDragging: false,
    isFovAnimationInProgress: false,
    cameraChange,
    onCameraChange: vi.fn(() => cameraChange.dispatch()),
  }
  const scene = {
    getBounds: () =>
      new Box3(new Vector3(-20, -30, -40), new Vector3(10, 20, 30)),
    getSelectionBounds: () => undefined,
    canRotate: vi.fn(() => true),
  }
  const driver = new DriverSpaceMouseController(controls, scene, vi.fn())
  canvas.focus()
  return { driver, controls, scene, camera, canvas }
}

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.stubGlobal('_3Dconnexion', FakeDriver)
  FakeDriver.instances = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('SpaceMouse local camera', () => {
  it('applies translation and rotation together and reads subsequent mouse changes', () => {
    const { driver, camera, controls } = setup()
    const rotation = new Quaternion().setFromEuler(new Euler(0.2, 0.3, 0.4))
    const pan = new Vector3(20, 0, 0).applyQuaternion(rotation)
    const position = new Vector3(0, 0, 70).applyQuaternion(rotation).add(pan)
    const matrix = new Matrix4().compose(
      position,
      rotation,
      new Vector3(1, 1, 1)
    )
    driver.setViewMatrix(matrix.toArray())

    expect(camera.position.distanceTo(position)).toBeLessThan(1e-8)
    expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7)
    expect(controls.target.distanceTo(pan)).toBeLessThan(1e-8)
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(70)
    expect(
      camera.up.distanceTo(new Vector3(0, 1, 0).applyQuaternion(rotation))
    ).toBeLessThan(1e-8)
    expect(controls.onCameraChange).toHaveBeenCalledOnce()

    camera.position.set(30, 50, 70)
    expect(new Matrix4().fromArray(driver.getViewMatrix()).elements).toEqual(
      camera.matrixWorld.elements
    )
    expect(
      new Vector3()
        .setFromMatrixPosition(new Matrix4().fromArray(driver.getViewMatrix()))
        .toArray()
    ).toEqual([30, 50, 70])
    driver.dispose()
  })

  it('uses current projection, zoom and actual scene bounds', () => {
    const { driver, controls } = setup()
    const camera = new OrthographicCamera(-80, 80, 50, -50, -1000, 1000)
    camera.position.set(0, 0, 100)
    camera.zoom = 2
    controls.camera = camera
    expect(driver.getPerspective()).toBe(false)
    expect(driver.getViewExtents()).toEqual([-40, -25, -1000, 40, 25, 1000])
    driver.setViewExtents([-20, -12.5, -1000, 20, 12.5, 1000])
    expect(camera.zoom).toBe(4)
    expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual([
      -80, 80, 50, -50,
    ])
    expect(driver.getModelExtents()).toEqual([-20, -30, -40, 10, 20, 30])
    expect(driver.getSelectionEmpty()).toBe(true)
    driver.dispose()
  })

  it.each([0.5, 1, 2])(
    'uses the SDK vertical field of view at aspect ratio %s',
    (aspect) => {
      const camera = new PerspectiveCamera(45, aspect, 0.1, 1000)
      const { driver } = setup(camera)
      expect(driver.getFov()).toBeCloseTo(Math.PI / 4)
      driver.setFov(Math.PI / 3)
      expect(camera.fov).toBeCloseTo(60)
      const frustum = driver.getViewFrustum()
      expect(2 * Math.atan(frustum[3] / frustum[4])).toBeCloseTo(Math.PI / 3)
      driver.dispose()
    }
  )

  it('reports Z-up and the front view along negative Y', () => {
    const { driver } = setup()
    const coordinateSystem = new Matrix4().fromArray(
      driver.getCoordinateSystem()
    )
    expect(
      new Vector3(0, 0, 1).transformDirection(coordinateSystem).toArray()
    ).toEqual([0, 1, 0])
    expect(
      new Vector3(1, 0, 0).transformDirection(coordinateSystem).toArray()
    ).toEqual([1, 0, 0])
    const frontView = new Matrix4().fromArray(driver.getFrontView())
    expect(
      new Vector3(0, 0, 1).transformDirection(frontView).toArray()
    ).toEqual([0, -1, 0])
    expect(
      new Vector3(0, 1, 0).transformDirection(frontView).toArray()
    ).toEqual([0, 0, 1])
    driver.dispose()
  })

  it('locks rotation in a sketch while allowing pan and zoom', () => {
    const { driver, camera, scene } = setup()
    scene.canRotate.mockReturnValue(false)
    expect(driver.getViewRotatable()).toBe(false)
    driver.setViewMatrix(
      new Matrix4().makeRotationX(0.5).setPosition(10, 20, 100).toArray()
    )
    expect(camera.position.toArray()).toEqual([0, 0, 100])
    driver.setViewMatrix(new Matrix4().makeTranslation(10, 20, 100).toArray())
    expect(camera.position.toArray()).toEqual([10, 20, 100])
    driver.dispose()
  })

  it('leaves the SDK construction-plane reader unsupported in free 3D views', () => {
    const { driver, scene } = setup(
      new OrthographicCamera(-50, 50, 50, -50, -1000, 1000)
    )
    const sdk: unknown = runInNewContext(
      `${vendorSource}\nnew _3Dconnexion(client)`,
      {
        client: driver,
        window: {},
        setTimeout,
        clearTimeout,
      }
    )
    expect(sdk).toHaveProperty(
      ['clientFnRead', 'view.constructionPlane'],
      undefined
    )
    expect(driver.getViewRotatable()).toBe(true)
    scene.canRotate.mockReturnValue(false)
    expect(driver.getViewRotatable()).toBe(false)
    scene.canRotate.mockReturnValue(true)
    expect(driver.getViewRotatable()).toBe(true)
    driver.dispose()
  })

  it('ignores input after focus loss, in streamed mode and after disposal', () => {
    const { driver, controls, camera, canvas } = setup()
    const move = new Matrix4().makeTranslation(10, 20, 100).toArray()
    canvas.blur()
    driver.setViewMatrix(move)
    canvas.focus()
    controls.localCameraMode = false
    driver.setViewMatrix(move)
    controls.localCameraMode = true
    driver.dispose()
    driver.setViewMatrix(move)
    expect(camera.position.toArray()).toEqual([0, 0, 100])
    expect(canvas.hasAttribute('tabindex')).toBe(false)
    expect(canvas.hasAttribute('id')).toBe(false)
  })

  it('ignores malformed input without poisoning the shared camera', () => {
    const { driver, camera, controls } = setup()
    driver.setViewMatrix([1, 2, 3])
    driver.setViewMatrix(new Array<number>(16).fill(Number.NaN))
    driver.setFov(Number.NaN)
    expect(camera.position.toArray()).toEqual([0, 0, 100])
    expect(controls.onCameraChange).not.toHaveBeenCalled()
    driver.dispose()
  })
})

describe('SpaceMouse connection lifecycle', () => {
  const busyFlags: Array<'isDragging' | 'isFovAnimationInProgress'> = [
    'isDragging',
    'isFovAnimationInProgress',
  ]

  it.each(busyFlags)(
    'resumes held-puck motion after %s without another motion-start event',
    async (busyFlag) => {
      const frames = new Map<number, FrameRequestCallback>()
      let frameId = 0
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
        (callback) => {
          frames.set(++frameId, callback)
          return frameId
        }
      )
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
        frames.delete(id)
      })
      const nextFrame = (time: number) => {
        const scheduled = frames.entries().next().value
        expect(scheduled).toBeDefined()
        if (!scheduled) throw new Error('No SpaceMouse frame scheduled')
        const [id, callback] = scheduled
        frames.delete(id)
        callback(time)
      }
      const { driver, controls, camera } = setup()
      const connection = driver.connect()
      await Promise.resolve()
      const sdk = FakeDriver.instances[0]
      sdk.client.onConnect()
      sdk.client.on3dmouseCreated()
      await connection
      sdk.update3dcontroller.mockClear()

      sdk.client.onStartMotion()
      controls[busyFlag] = true
      nextFrame(16)
      driver.setViewMatrix(new Matrix4().makeTranslation(10, 20, 100).toArray())
      expect(sdk.update3dcontroller).not.toHaveBeenCalled()
      expect(camera.position.toArray()).toEqual([0, 0, 100])
      expect(frames.size).toBe(1)

      controls[busyFlag] = false
      nextFrame(32)
      expect(sdk.update3dcontroller).toHaveBeenCalledWith({
        frame: { time: 32 },
      })

      driver.onStopMotion()
      expect(frames.size).toBe(0)
      controls[busyFlag] = true
      sdk.client.onStartMotion()
      nextFrame(48)
      controls[busyFlag] = false
      nextFrame(64)
      expect(sdk.update3dcontroller).toHaveBeenLastCalledWith({
        frame: { time: 64 },
      })
      driver.dispose()
      expect(frames.size).toBe(0)
    }
  )

  it('rebases cached Navlib motion after mouse navigation and ignores old replies', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const { driver, controls, camera } = setup()
    const connection = driver.connect()
    await Promise.resolve()
    const sdk = FakeDriver.instances[0]
    sdk.client.onConnect()
    sdk.client.on3dmouseCreated()
    await connection
    // Navlib reads the camera at motion start, then keeps its own cached pose.
    const cached = new Matrix4().fromArray(driver.getViewMatrix())
    sdk.update3dcontroller.mockImplementation(
      (update: { frame?: { time?: number } }) => {
        if (update.frame?.time === undefined) return
        const position = new Vector3().setFromMatrixPosition(cached)
        cached.setPosition(position.add(new Vector3(1, 0, 0)))
        sdk.client.setViewMatrix(cached.toArray())
      }
    )
    const acknowledgement = Promise.withResolvers<unknown>()
    sdk.session.call.mockReturnValue(acknowledgement.promise)
    sdk.client.onStartMotion()
    frames.shift()?.(16)
    expect(camera.position.x).toBe(1)

    controls.isDragging = true
    camera.position.x += 50
    controls.target.x += 50
    controls.onCameraChange()
    const newView = driver.getViewMatrix()
    sdk.client.setViewMatrix(cached.toArray())
    expect(camera.position.x).toBe(51)
    frames.shift()?.(32)
    controls.isDragging = false
    frames.shift()?.(48)
    expect(sdk.session.call).toHaveBeenCalledWith(
      '3dx_rpc:update',
      '3dconnexion:3dcontroller/1',
      {
        view: {
          affine: newView,
          target: [51, 0, 0],
          perspective: true,
          rotatable: true,
          fov: Math.PI / 4,
          frustum: driver.getViewFrustum(),
        },
      }
    )
    sdk.client.setViewMatrix(cached.toArray())
    frames.shift()?.(64)
    expect(camera.position.x).toBe(51)
    expect(sdk.session.call).toHaveBeenCalledOnce()

    cached.fromArray(newView)
    acknowledgement.resolve(undefined)
    await Promise.resolve()
    frames.shift()?.(80)
    expect(camera.position.x).toBe(52)
    frames.shift()?.(96)
    expect(camera.position.x).toBe(53)
    expect(sdk.session.call).toHaveBeenCalledOnce()
    driver.dispose()
  })

  it('keeps newer camera changes pending when an older cache update completes', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const { driver, controls, camera } = setup()
    const connection = driver.connect()
    await Promise.resolve()
    const sdk = FakeDriver.instances[0]
    sdk.client.on3dmouseCreated()
    await connection
    const first = Promise.withResolvers<unknown>()
    const second = Promise.withResolvers<unknown>()
    sdk.session.call
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    driver.onStartMotion()
    camera.position.x = 10
    controls.onCameraChange()
    frames.shift()?.(16)
    camera.position.x = 20
    controls.onCameraChange()
    first.resolve(undefined)
    await Promise.resolve()
    driver.setViewMatrix(new Matrix4().makeTranslation(10, 0, 100).toArray())
    expect(camera.position.x).toBe(20)
    frames.shift()?.(32)
    expect(sdk.session.call).toHaveBeenCalledTimes(2)
    second.resolve(undefined)
    await Promise.resolve()
    frames.shift()?.(48)
    expect(sdk.update3dcontroller).toHaveBeenLastCalledWith({
      frame: { time: 48 },
    })
    driver.dispose()
  })

  it('waits for controller creation rather than only the websocket', async () => {
    const { driver, canvas } = setup()
    const connected = vi.fn()
    const connection = driver.connect().then(connected)
    await Promise.resolve()
    const sdk = FakeDriver.instances[0]
    sdk.client.onConnect()
    expect(sdk.create3dmouse).toHaveBeenCalledWith(canvas, 'Zoo Design Studio')
    expect(connected).not.toHaveBeenCalled()
    sdk.client.on3dmouseCreated()
    await connection
    expect(connected).toHaveBeenCalledWith(undefined)
    driver.dispose()
  })

  it('fails when the service never creates a controller', async () => {
    vi.useFakeTimers()
    const { driver } = setup()
    const connection = driver.connect(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(await connection).toBeInstanceOf(Error)
    driver.dispose()
  })

  it('cancels pending work and closes sessions that arrive after disposal', async () => {
    const { driver } = setup()
    const connection = driver.connect()
    await Promise.resolve()
    const sdk = FakeDriver.instances[0]
    driver.dispose()
    expect(await connection).toBeInstanceOf(Error)
    sdk.client.onConnect()
    sdk.client.on3dmouseCreated()
    expect(sdk.create3dmouse).not.toHaveBeenCalled()
    expect(sdk.close).toHaveBeenCalled()
  })

  it('does not reconnect or change state when disabled during connection', async () => {
    const { driver, controls, scene } = setup()
    driver.dispose()
    const controller = new SpaceMouseController(controls, scene)
    const connection = controller.connect()
    controller.dispose()
    await connection
    expect(spaceMouseState.value.status).toBe('disconnected')
    expect(FakeDriver.instances).toHaveLength(0)
  })
})
