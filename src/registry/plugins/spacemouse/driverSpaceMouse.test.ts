import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

class FakeDriver {
  static instances: FakeDriver[] = []
  connect = vi.fn(() => 1)
  create3dmouse = vi.fn()
  update3dcontroller = vi.fn()
  delete3dmouse = vi.fn()
  close = vi.fn()

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
    onCameraChange: vi.fn(),
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

  it('round trips the SDK diagonal field of view', () => {
    const camera = new PerspectiveCamera(45, 2, 0.1, 1000)
    const { driver } = setup(camera)
    const diagonal = 2 * Math.atan(Math.tan(Math.PI / 8) * Math.sqrt(5))
    expect(driver.getFov()).toBeCloseTo(diagonal)
    driver.setFov(diagonal)
    expect(camera.fov).toBeCloseTo(45)
    driver.dispose()
  })

  it('reports Z-up and the front view along negative Y', () => {
    const { driver } = setup()
    const coordinateSystem = new Matrix4().fromArray(
      driver.getCoordinateSystem()
    )
    expect(
      new Vector3(0, 1, 0).transformDirection(coordinateSystem).toArray()
    ).toEqual([0, 0, 1])
    expect(
      new Vector3(0, 0, 1)
        .transformDirection(new Matrix4().fromArray(driver.getFrontView()))
        .toArray()
    ).toEqual([0, -1, 0])
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
