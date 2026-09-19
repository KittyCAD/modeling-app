import {
  CameraControls,
  letEngineAnimateAndSyncCamAfter,
} from '@src/clientSideScene/CameraControls'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { getDimensions } from '@src/lib/engineConnection/utils'
import {
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  Vector3,
} from 'three'
import * as TWEEN from '@tweenjs/tween.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  TWEEN.removeAll()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, get: () => width },
    clientHeight: { configurable: true, get: () => height },
  })
  return canvas
}

function makeConnectionManager(
  streamDimensions: ConnectionManager['streamDimensions']
) {
  return {
    streamDimensions,
    sendSceneCommand: vi.fn().mockResolvedValue(undefined),
    subscribeTo: vi.fn(),
    subscribeToUnreliable: vi.fn(),
  } as unknown as ConnectionManager
}

function unusedSettings(): never {
  throw new Error('Settings are not used by viewport projection updates')
}

describe('local canvas spherical orbit', () => {
  function setup(local = true) {
    const canvas = makeCanvas(1024, 768)
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1024, 768)
    )
    const manager = makeConnectionManager({ width: 1024, height: 768 })
    const controls = new CameraControls(canvas, manager, unusedSettings)
    controls.localCameraMode = local
    controls.target.set(10, 20, 30)
    controls.camera.position.copy(controls.target).add(new Vector3(0, -100, 0))
    controls.camera.up.set(0, 0, 1)
    controls.camera.lookAt(controls.target)
    controls.camera.updateMatrixWorld()
    vi.spyOn(controls, 'getInteractionType').mockReturnValue('rotate')
    const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
    return { controls, send }
  }

  function pointer(x: number, y: number) {
    return new PointerEvent('pointermove', {
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      button: 2,
      buttons: 2,
    })
  }

  it.each(['perspective', 'orthographic'] as const)(
    'continues through both poles for multiple revolutions in %s',
    (projection) => {
      const { controls, send } = setup()
      if (projection === 'orthographic') controls.useOrthographicCamera()
      send.mockClear()
      const target = controls.target.clone()
      const position = controls.camera.position.clone()
      const initialRotation = controls.camera.quaternion.clone()
      const previousRotation = initialRotation.clone()
      const initialZoom = controls.camera.zoom
      controls.onMouseDown(pointer(512, 100))

      // 0.25 degrees per pixel at 1024x768: 48 steps = a full revolution.
      // This hits both poles exactly, as well as crossing them in later steps.
      for (let step = 1; step <= 96; step++) {
        controls.onMouseMove(pointer(512, 100 + step * 30))
        const offset = controls.camera.position.clone().sub(target)
        expect(offset.length()).toBeCloseTo(100)
        expect(controls.target.equals(target)).toBe(true)
        expect(controls.camera.zoom).toBeCloseTo(initialZoom)
        expect(
          previousRotation.angleTo(controls.camera.quaternion)
        ).toBeCloseTo(Math.PI / 24)
        expect(
          controls.camera
            .getWorldDirection(new Vector3())
            .dot(offset.normalize())
        ).toBeCloseTo(-1)
        expect(
          controls.camera.up.distanceTo(
            new Vector3(0, 1, 0).applyQuaternion(controls.camera.quaternion)
          )
        ).toBeLessThan(1e-8)
        previousRotation.copy(controls.camera.quaternion)
        if (step === 12)
          expect(controls.camera.position.z - target.z).toBeCloseTo(100)
        if (step === 24) expect(controls.camera.up.z).toBeCloseTo(-1)
        if (step === 36)
          expect(controls.camera.position.z - target.z).toBeCloseTo(-100)
      }

      expect(controls.camera.position.distanceTo(position)).toBeLessThan(1e-7)
      expect(controls.camera.quaternion.angleTo(initialRotation)).toBeLessThan(
        1e-6
      )
      controls.onMouseUp(pointer(512, 2980))
      expect(send).not.toHaveBeenCalled()
    }
  )

  it('locks horizontal direction for a drag, then adapts when a new drag starts inverted', () => {
    const { controls } = setup()
    controls.onMouseDown(pointer(512, 100))
    for (let step = 1; step <= 24; step++)
      controls.onMouseMove(pointer(512, 100 + step * 30))
    const invertedPosition = controls.camera.position.clone()
    controls.onMouseMove(pointer(632, 820))
    expect(
      controls.camera.position.distanceTo(invertedPosition)
    ).toBeGreaterThan(1)
    controls.onMouseUp(pointer(632, 820))

    controls.onMouseDown(pointer(632, 820))
    controls.onMouseMove(pointer(752, 820))
    expect(controls.camera.position.distanceTo(invertedPosition)).toBeLessThan(
      1e-7
    )
  })

  it('keeps the existing cube gizmo pending-rotation clamp', () => {
    const { controls } = setup()
    controls.pendingRotation = new Vector2(0, 10000)
    controls.update()
    const position = controls.camera.position.clone()
    controls.pendingRotation = new Vector2(0, 10000)
    controls.update()
    expect(controls.camera.position.distanceTo(position)).toBeLessThan(1e-8)
  })

  it('still delegates streamed right-drag to the engine', () => {
    const { controls, send } = setup(false)
    const position = controls.camera.position.clone()
    controls.onMouseDown(pointer(512, 100))
    controls.onMouseMove(pointer(512, 130))
    expect(controls.camera.position.equals(position)).toBe(true)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'camera_drag_move',
          interaction: 'rotate',
        }),
      })
    )
  })
})

describe('CameraControls viewport projection', () => {
  it('uses the normalized displayed viewport instead of delayed stream dimensions', () => {
    const displayDimensions = { width: 655, height: 836 }
    const delayedStreamDimensions = { width: 656, height: 840 }
    const normalizedDimensions = getDimensions(
      displayDimensions.width,
      displayDimensions.height
    )
    const normalizedAspect =
      normalizedDimensions.width / normalizedDimensions.height
    const controls = new CameraControls(
      makeCanvas(displayDimensions.width, displayDimensions.height),
      makeConnectionManager(delayedStreamDimensions),
      unusedSettings
    )

    expect(controls.camera).toBeInstanceOf(PerspectiveCamera)
    expect((controls.camera as PerspectiveCamera).aspect).toBeCloseTo(
      normalizedAspect
    )

    controls.useOrthographicCamera()

    expect(controls.camera).toBeInstanceOf(OrthographicCamera)
    expect((controls.camera as OrthographicCamera).right).toBeCloseTo(
      20 * normalizedAspect
    )
    expect((controls.camera as OrthographicCamera).right).not.toBeCloseTo(
      20 * (delayedStreamDimensions.width / delayedStreamDimensions.height),
      5
    )
  })
})

describe('local sketch camera transition', () => {
  function setup(geometryOnly = true) {
    const manager = makeConnectionManager({ width: 800, height: 600 })
    Object.defineProperty(manager, 'geometryOnly', { value: geometryOnly })
    const controls = new CameraControls(
      makeCanvas(800, 600),
      manager,
      unusedSettings
    )
    controls.localCameraMode = geometryOnly
    controls.camera.position.set(100, 100, 100)
    controls.target.set(0, 0, 0)
    controls.camera.lookAt(controls.target)
    const sendSceneCommand = vi.spyOn(manager, 'sendSceneCommand').mockClear()
    return { manager, controls, sendSceneCommand }
  }

  it('aligns once using the existing eye distance, without engine camera commands', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { manager, controls, sendSceneCommand } = setup()
    const sketch = new Group()
    sketch.position.set(200, 300, 400)
    sketch.rotateX(Math.PI / 2)
    const expectedDistance = controls.camera.position.distanceTo(
      sketch.position
    )
    const expectedHalfHeight = expectedDistance * Math.tan(Math.PI / 8)
    await letEngineAnimateAndSyncCamAfter(manager, 'plane-id', controls)
    await controls.transitionToSketch(sketch)

    expect(sendSceneCommand).toHaveBeenCalledTimes(1)
    expect(sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'enable_sketch_mode',
          adjust_camera: false,
          animated: false,
        }),
      })
    )
    expect(controls.camera).toBeInstanceOf(OrthographicCamera)
    expect(controls.camera.zoom).toBeCloseTo(20 / expectedHalfHeight)
    expect(controls.camera.position.distanceTo(controls.target)).toBeCloseTo(
      expectedDistance
    )
    expect(controls.camera.quaternion.angleTo(sketch.quaternion)).toBeLessThan(
      1e-8
    )
    expect(controls.target.toArray()).toEqual([200, 300, 400])

    // Subsequent geometry/tool updates must not move the camera again.
    const position = controls.camera.position.clone()
    sketch.position.set(500, 500, 500)
    await controls.transitionToSketch(sketch)
    expect(controls.camera.position.equals(position)).toBe(true)

    // Projection changes preserve scale, including after zooming in sketch mode.
    controls.camera.zoom *= 2
    controls.onCameraChange()
    await controls.snapToPerspectiveBeforeHandingBackControlToEngine()
    expect(controls.camera).toBeInstanceOf(PerspectiveCamera)
    const camera = controls.camera
    if (!(camera instanceof PerspectiveCamera)) {
      throw new Error('Expected a perspective camera after leaving sketch mode')
    }
    const visibleHalfHeight =
      camera.position.distanceTo(controls.target) *
      Math.tan((camera.getEffectiveFOV() * Math.PI) / 360)
    expect(visibleHalfHeight).toBeCloseTo(expectedHalfHeight / 2)
    expect(camera.near).toBe(1)
    expect(camera.far).toBe(10000)
    expect(sendSceneCommand).toHaveBeenCalledTimes(1)
  })

  it.each([100, 1000])(
    'preserves a %d mm eye distance on entry',
    async (distance) => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }))
      const { controls } = setup()
      controls.camera.position.set(0, 0, distance)
      controls.requestSketchCameraTransition()
      await controls.transitionToSketch(new Group())
      expect(controls.camera.position.z).toBeCloseTo(distance)
      expect(controls.camera.zoom).toBeCloseTo(
        20 / (distance * Math.tan(Math.PI / 8))
      )
    }
  )

  it('honours orthographic wheel zoom when entering a sketch', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { controls } = setup()
    controls.camera.position.set(0, 0, 1000)
    controls.useOrthographicCamera()
    controls.camera.zoom *= 4
    controls.onCameraChange()
    const zoom = controls.camera.zoom
    controls.requestSketchCameraTransition()
    await controls.transitionToSketch(new Group())
    expect(controls.camera.zoom).toBeCloseTo(zoom)
    expect(controls.camera.position.z).toBeCloseTo(250)
  })

  it('uses the engine face centre rather than the sketch origin', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { manager, controls, sendSceneCommand } = setup()
    const scene = new Group()
    scene.scale.setScalar(25.4)
    const sketch = new Group()
    scene.add(sketch)
    await letEngineAnimateAndSyncCamAfter(manager, 'face-id', controls, true)
    sendSceneCommand.mockResolvedValueOnce({
      success: true,
      resp: {
        type: 'modeling',
        data: {
          modeling_response: {
            type: 'face_get_center',
            data: { pos: { x: 10, y: 20, z: 30 } },
          },
        },
      },
    })
    await controls.transitionToSketch(sketch)
    expect(sendSceneCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cmd: { type: 'face_get_center', object_id: 'face-id' },
      })
    )
    expect(controls.target.toArray()).toEqual([254, 508, 762])
    expect(controls.camera.quaternion.angleTo(sketch.quaternion)).toBeLessThan(
      1e-8
    )
  })

  it('ignores a face-centre response after leaving sketch mode', async () => {
    const { controls, sendSceneCommand } = setup()
    let complete!: () => void
    sendSceneCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () => resolve(null)
        })
    )
    controls.requestSketchCameraTransition('face-id')
    const transition = controls.transitionToSketch(new Group())
    controls.cancelSketchCameraTransition()
    complete()
    await transition
    expect(controls.camera).toBeInstanceOf(PerspectiveCamera)
  })

  it.each([
    [0.1, 0.001],
    [0.2, 0.001],
    [1, 0.01],
    [10, 0.1],
    [100, 1],
    [1000, 10],
    [10000, 100],
    [100000, 1000],
  ])('uses engine clipping for local eye distance %d', (distance, scale) => {
    const { controls } = setup()
    controls.camera.position.set(0, 0, distance)
    controls.onCameraChange()
    expect(controls.camera.near).toBe(scale)
    expect(controls.camera.far).toBe(scale * 10000)
    controls.useOrthographicCamera()
    expect(controls.camera.near).toBe(-controls.camera.far)
  })

  it('leaves streamed camera clipping unchanged', () => {
    const { controls } = setup(false)
    controls.camera.position.set(0, 0, 1000)
    controls.onCameraChange()
    expect(controls.camera.near).toBe(100)
    expect(controls.camera.far).toBe(2000)
  })

  it('keeps streamed sketch entry delegated to the engine', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { manager, controls, sendSceneCommand } = setup(false)
    const pending = letEngineAnimateAndSyncCamAfter(
      manager,
      'plane-id',
      controls
    )
    await vi.advanceTimersByTimeAsync(600)
    await pending
    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'enable_sketch_mode',
          adjust_camera: true,
          animated: true,
        }),
      })
    )
    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cmd: { type: 'default_camera_get_settings' },
      })
    )
    expect(controls.camera).toBeInstanceOf(PerspectiveCamera)
  })

  it('stops an in-flight transition when its sketch actor is cancelled', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { controls } = setup()
    const abort = new AbortController()
    controls.requestSketchCameraTransition()
    const pending = controls.transitionToSketch(new Group(), abort.signal)
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    })
    TWEEN.update(TWEEN.now() + 200)
    abort.abort()
    await rejected
    const position = controls.camera.position.clone()
    TWEEN.update(TWEEN.now() + 1000)
    expect(controls.camera.position.equals(position)).toBe(true)
    expect(controls.target.distanceTo(new Vector3())).toBeLessThan(1e-8)
  })

  it('does not queue a stale transition when sketch entry responds after cancellation', async () => {
    const { manager, controls, sendSceneCommand } = setup()
    let complete!: () => void
    sendSceneCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () => resolve(null)
        })
    )
    const entry = letEngineAnimateAndSyncCamAfter(manager, 'plane-id', controls)
    controls.cancelSketchCameraTransition()
    complete()
    await entry
    await controls.transitionToSketch(new Group())
    expect(controls.camera).toBeInstanceOf(PerspectiveCamera)
  })
})
