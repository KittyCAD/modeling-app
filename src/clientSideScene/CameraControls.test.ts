import type { CameraViewState, BatchResponse, OkModelingCmdResponse, WebSocketResponse } from '@kittycad/lib'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { promiseFactory } from '@src/lib/utils'
import {
  CameraControls,
  enterSketchModeAndSyncCamera,
} from '@src/clientSideScene/CameraControls'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { getDimensions } from '@src/lib/engineConnection/utils'
import {
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector2,
  Vector3,
} from 'three'
import { afterEach, describe, expect, it, type MockInstance, vi } from 'vitest'

afterEach(() => {
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
    sendSceneCommand: vi.fn().mockImplementation(async (command: EngineCommand) => {
      if (command.type === 'modeling_cmd_batch_req') return cameraBatchAcknowledgement(command)
      if (command.type === 'modeling_cmd_req' &&
        (command.cmd.type === 'enable_sketch_mode' || command.cmd.type === 'sketch_mode_disable' ||
         command.cmd.type === 'default_camera_look_at' || command.cmd.type === 'default_camera_perspective_settings')) {
        return cameraAcknowledgement(command.cmd.type)
      }
      return undefined
    }),
    subscribeTo: vi.fn(),
    subscribeToUnreliable: vi.fn(),
  } as unknown as ConnectionManager
}

function unusedSettings(): never {
  throw new Error('Settings are not used by viewport projection updates')
}

/** What was sent, leaving out the client telling the engine where its camera is. */
function commandsBesidesCameraPushes(
  send: MockInstance<ConnectionManager['sendSceneCommand']>
) {
  return send.mock.calls
    .map(([command]) =>
      command.type === 'modeling_cmd_req' ? command.cmd.type : command.type
    )
    .filter(
      (type) =>
        type !== 'default_camera_look_at' &&
        type !== 'default_camera_set_orthographic' &&
        type !== 'default_camera_set_perspective'
    )
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
      expect(commandsBesidesCameraPushes(send)).toEqual([])
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
    vi.useFakeTimers()
    const { controls, send } = setup(false)
    const position = controls.camera.position.clone()
    controls.onMouseDown(pointer(512, 100))
    controls.onMouseMove(pointer(512, 130))
    vi.advanceTimersToNextFrame()
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

function cameraResponse(response: OkModelingCmdResponse): WebSocketResponse {
  return {
    success: true,
    resp: { type: 'modeling', data: { modeling_response: response } },
  }
}

function cameraAcknowledgement(
  type:
    | 'default_camera_look_at'
    | 'default_camera_perspective_settings'
    | 'enable_sketch_mode'
    | 'sketch_mode_disable'
): WebSocketResponse {
  return cameraResponse({ type, data: {} })
}

const cameraSettingsResponse = {
  type: 'default_camera_get_settings',
  data: {
    settings: {
      center: { x: 0, y: 0, z: 0 },
      pos: { x: 0, y: 0, z: 10 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      up: { x: 0, y: 1, z: 0 },
      ortho: false,
      fov_y: 45,
    },
  },
} satisfies OkModelingCmdResponse

function cameraBatchAcknowledgement(
  command: EngineCommand,
  fault?: {
    type: string
    result: BatchResponse | null
    skipRemaining?: boolean
  }
) {
  if (command.type !== 'modeling_cmd_batch_req')
    expect.fail('Expected a camera batch')
  const responses: Record<string, BatchResponse> = {}
  for (const { cmd_id, cmd } of command.requests) {
    if (
      cmd.type !== 'enable_sketch_mode' &&
      cmd.type !== 'sketch_mode_disable' &&
      cmd.type !== 'default_camera_perspective_settings' &&
      cmd.type !== 'default_camera_get_settings'
    )
      expect.fail('Unexpected camera command')
    if (fault?.type === cmd.type) {
      if (fault.result) responses[cmd_id] = fault.result
      if (fault.skipRemaining) break
    } else {
      responses[cmd_id] = {
        response:
          cmd.type === 'default_camera_get_settings'
            ? cameraSettingsResponse
            : { type: cmd.type, data: {} },
      }
    }
  }
  if (fault && !command.requests.some(({ cmd }) => cmd.type === fault.type))
    expect.fail('Missing camera command')
  return {
    success: true,
    request_id: command.batch_id,
    resp: { type: 'modeling_batch', data: { responses } },
  } satisfies WebSocketResponse
}

function makeCameraControls(canvas = makeCanvas(256, 256)) {
  const manager = makeConnectionManager({ width: 256, height: 256 })
  const subscriptions = vi.spyOn(manager, 'subscribeTo')
  const controls = new CameraControls(canvas, manager, unusedSettings)
  const settingsSubscription = subscriptions.mock.calls.find(
    ([{ event }]) => event === 'default_camera_get_settings'
  )?.[0]
  if (!settingsSubscription)
    expect.fail('Missing authoritative camera subscription')
  return { manager, controls, settingsSubscription }
}

function makeSketchCamera() {
  const fixture = makeCameraControls()
  fixture.controls.camera = new OrthographicCamera(-10, 10, 10, -10)
  fixture.controls.camera.position.set(0, -10, 10)
  fixture.controls.syncDirection = 'clientToEngine'
  return fixture
}

describe('immediate camera changes', () => {
  afterEach(() => vi.useRealTimers())

  it('enters sketch mode without motion or a fixed wait, then awaits camera synchronization', async () => {
    vi.useFakeTimers()
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const synchronized = promiseFactory<WebSocketResponse>()
    const send = vi
      .spyOn(manager, 'sendSceneCommand')
      .mockReturnValue(synchronized.promise)
    let completed = false
    const entering = enterSketchModeAndSyncCamera(manager, 'plane-id').then(
      () => {
        completed = true
      }
    )
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'modeling_cmd_batch_req',
        responses: true,
        requests: [
          {
            cmd_id: expect.any(String),
            cmd: {
              type: 'enable_sketch_mode',
              adjust_camera: true,
              animated: false,
              ortho: true,
              entity_id: 'plane-id',
            },
          },
          {
            cmd_id: expect.any(String),
            cmd: { type: 'default_camera_get_settings' },
          },
        ],
      }),
      true
    )
    expect(completed).toBe(false)
    synchronized.resolve(cameraBatchAcknowledgement(send.mock.calls[0][0]))
    await entering
    expect(completed).toBe(true)
  })

  it.each(['enable_sketch_mode', 'default_camera_get_settings'])(
    'surfaces the exact batch failure for %s',
    async (type) => {
      const manager = makeConnectionManager({ width: 256, height: 256 })
      vi.spyOn(manager, 'sendSceneCommand').mockImplementation(
        async (command) =>
          cameraBatchAcknowledgement(command, {
            type,
            result: {
              errors: [
                { error_code: 'bad_request', message: `${type} failed` },
              ],
            },
          })
      )
      await expect(
        enterSketchModeAndSyncCamera(manager, 'plane-id')
      ).rejects.toThrow(`${type} failed`)
    }
  )

  it.each(['missing', 'mismatched'])(
    'rejects a %s get-settings result instead of completing sketch entry',
    async (failure) => {
      const manager = makeConnectionManager({ width: 256, height: 256 })
      vi.spyOn(manager, 'sendSceneCommand').mockImplementation(
        async (command) =>
          cameraBatchAcknowledgement(command, {
            type: 'default_camera_get_settings',
            result:
              failure === 'missing'
                ? null
                : {
                    response: { type: 'enable_sketch_mode', data: {} },
                  },
          })
      )
      await expect(
        enterSketchModeAndSyncCamera(manager, 'plane-id')
      ).rejects.toThrow(
        'Camera command default_camera_get_settings was not acknowledged'
      )
    }
  )

  it('sets the final orientation immediately while preserving distance and awaiting the final engine update', async () => {
    vi.useFakeTimers()
    const { manager, controls } = makeCameraControls()
    controls.syncDirection = 'clientToEngine'
    controls.camera.position.set(0, 0, 10)
    vi.spyOn(controls, 'updateEngineCamera').mockImplementation(() => {})
    const updated = promiseFactory<WebSocketResponse>()
    const send = vi
      .spyOn(manager, 'sendSceneCommand')
      .mockImplementationOnce(() => updated.promise)
    const destination = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI / 2
    )
    const target = new Vector3(3, 4, 5)
    const change = controls.setCameraToQuaternion(destination, target)

    expect(controls.camera.quaternion.angleTo(destination)).toBeLessThan(1e-6)
    expect(controls.target).toEqual(target)
    expect(controls.camera.position.distanceTo(target)).toBeCloseTo(10)
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        cmd: expect.objectContaining({ type: 'default_camera_look_at' }),
      }),
      true
    )
    updated.resolve(cameraAcknowledgement('default_camera_look_at'))
    await change
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('disables sketch mode and restores authoritative perspective in one acknowledged batch', async () => {
    vi.useFakeTimers()
    const { manager, controls, settingsSubscription } = makeSketchCamera()
    controls.lastPerspectiveFov = 30
    controls.perspectiveFovBeforeOrtho = 45
    const acknowledged = promiseFactory<WebSocketResponse>()
    const send = vi
      .spyOn(manager, 'sendSceneCommand')
      .mockReturnValue(acknowledged.promise)
    let completed = false
    const restoring = controls
      .snapToPerspectiveBeforeHandingBackControlToEngine()
      .then(() => {
        completed = true
      })

    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'modeling_cmd_batch_req',
        responses: true,
        requests: [
          { cmd_id: expect.any(String), cmd: { type: 'sketch_mode_disable' } },
          {
            cmd_id: expect.any(String),
            cmd: expect.objectContaining({
              type: 'default_camera_perspective_settings',
              fov_y: 45,
            }),
          },
          {
            cmd_id: expect.any(String),
            cmd: { type: 'default_camera_get_settings' },
          },
        ],
      }),
      true
    )
    expect(controls.camera).toBeInstanceOf(OrthographicCamera)
    const batch = send.mock.calls[0][0]
    if (batch.type !== 'modeling_cmd_batch_req')
      expect.fail('Expected exit batch')
    const perspective = batch.requests.find(
      ({ cmd }) => cmd.type === 'default_camera_perspective_settings'
    )?.cmd
    if (perspective?.type !== 'default_camera_perspective_settings')
      expect.fail('Expected final perspective settings')
    const finalDistance = new Vector3(
      perspective.vantage.x,
      perspective.vantage.y,
      perspective.vantage.z
    ).distanceTo(controls.target)
    expect(2 * finalDistance * Math.tan(Math.PI / 8)).toBeCloseTo(
      2 *
        controls.camera.position.distanceTo(controls.target) *
        Math.tan(Math.PI / 12)
    )
    expect(controls.isFovAnimationInProgress).toBe(true)
    expect(completed).toBe(false)
    // The real manager dispatches successful subscribed replies before it
    // resumes the awaiting camera helper.
    settingsSubscription.callback(cameraSettingsResponse)
    acknowledged.resolve(cameraBatchAcknowledgement(send.mock.calls[0][0]))
    await restoring
    expect(completed).toBe(true)
    expect(controls.camera).toBeInstanceOf(PerspectiveCamera)
    expect(controls.camera.position).toEqual(new Vector3(0, 0, 10))
    expect(controls.isFovAnimationInProgress).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('cleans up perspective restoration when the final camera update fails', async () => {
    const { manager, controls } = makeCameraControls()
    controls.syncDirection = 'clientToEngine'
    vi.spyOn(manager, 'sendSceneCommand').mockRejectedValue(
      new Error('Engine disconnected')
    )
    await expect(
      controls.snapToPerspectiveBeforeHandingBackControlToEngine()
    ).rejects.toThrow('Engine disconnected')
    expect(controls.isFovAnimationInProgress).toBe(false)
  })

  it('requires the disable acknowledgement for an orthographic exit', async () => {
    const { manager, controls } = makeSketchCamera()
    vi.spyOn(manager, 'sendSceneCommand').mockResolvedValue(null)
    await expect(controls.disableSketchMode()).rejects.toThrow(
      'Camera command sketch_mode_disable was not acknowledged'
    )
  })

  it.each([
    'sketch_mode_disable',
    'default_camera_perspective_settings',
    'default_camera_get_settings',
  ])('does not publish perspective after %s fails', async (type) => {
    const { manager, controls } = makeSketchCamera()
    const original = controls.camera
    const changed = vi.fn()
    controls.cameraChange.add(changed)
    vi.spyOn(manager, 'sendSceneCommand').mockImplementation(async (command) =>
      cameraBatchAcknowledgement(command, {
        type,
        result: {
          errors: [{ error_code: 'bad_request', message: `${type} failed` }],
        },
        skipRemaining: true,
      })
    )
    await expect(
      controls.snapToPerspectiveBeforeHandingBackControlToEngine()
    ).rejects.toThrow(`${type} failed`)
    expect(controls.camera).toBe(original)
    expect(changed).not.toHaveBeenCalled()
    expect(controls.isFovAnimationInProgress).toBe(false)
  })

  it('rejects a retired connection without publishing its exit result', async () => {
    const { manager, controls } = makeSketchCamera()
    Object.defineProperty(manager, 'connection', {
      value: {},
      configurable: true,
    })
    const original = controls.camera
    const acknowledged = promiseFactory<WebSocketResponse>()
    const send = vi
      .spyOn(manager, 'sendSceneCommand')
      .mockReturnValue(acknowledged.promise)
    const restoring =
      controls.snapToPerspectiveBeforeHandingBackControlToEngine()
    const rejected = expect(restoring).rejects.toThrow(
      'Camera ownership changed'
    )
    Object.defineProperty(manager, 'connection', {
      value: {},
      configurable: true,
    })
    acknowledged.resolve(cameraBatchAcknowledgement(send.mock.calls[0][0]))
    await rejected
    expect(controls.camera).toBe(original)
    expect(controls.isFovAnimationInProgress).toBe(false)
  })

  it.each([
    { alreadySent: false, failed: false },
    { alreadySent: true, failed: false },
    { alreadySent: false, failed: true },
  ])(
    'drains newer input (already sent: $alreadySent, exit failed: $failed)',
    async ({ alreadySent, failed }) => {
      vi.useFakeTimers()
      const { manager, controls, settingsSubscription } = makeSketchCamera()
      const acknowledged = Promise.withResolvers<WebSocketResponse>()
      const send = vi
        .spyOn(manager, 'sendSceneCommand')
        .mockImplementation(async (command) => {
          if (command.type === 'modeling_cmd_batch_req')
            return acknowledged.promise
          if (command.type !== 'modeling_cmd_req')
            expect.fail('Expected camera command')
          if (command.cmd.type === 'default_camera_look_at') {
            expect(command.cmd.center).toMatchObject({ x: 4, y: 5, z: 6 })
            return cameraAcknowledgement('default_camera_look_at')
          }
          if (command.cmd.type !== 'default_camera_get_settings')
            expect.fail('Expected readback after user input')
          const response = {
            ...cameraSettingsResponse,
            data: {
              settings: {
                ...cameraSettingsResponse.data.settings,
                ortho: failed,
                fov_y: 55,
                pos: { x: 9, y: 10, z: 11 },
                center: { x: 4, y: 5, z: 6 },
              },
            },
          }
          settingsSubscription.callback(response)
          return cameraResponse(response)
        })
      const restoring =
        controls.snapToPerspectiveBeforeHandingBackControlToEngine()
      const result = failed
        ? expect(restoring).rejects.toThrow('Perspective failed')
        : expect(restoring).resolves.toBeUndefined()
      controls.camera.position.set(1, 2, 3)
      controls.target.set(4, 5, 6)
      controls.onCameraChange()
      if (alreadySent) await vi.advanceTimersByTimeAsync(20)
      if (failed) acknowledged.reject(new Error('Perspective failed'))
      else {
        settingsSubscription.callback(cameraSettingsResponse)
        acknowledged.resolve(cameraBatchAcknowledgement(send.mock.calls[0][0]))
      }
      await result
      controls.syncDirection = 'engineToClient'
      await vi.advanceTimersByTimeAsync(20)
      expect(
        send.mock.calls.map(([command]) =>
          command.type === 'modeling_cmd_req' ? command.cmd.type : command.type
        )
      ).toEqual([
        'modeling_cmd_batch_req',
        'default_camera_look_at',
        'default_camera_get_settings',
      ])
      expect(controls.camera.position).toEqual(new Vector3(9, 10, 11))
      expect(controls.target).toEqual(new Vector3(4, 5, 6))
      if (!failed) expect(controls.lastPerspectiveFov).toBe(55)
    }
  )

  it('does not treat a disconnected engine as a completed sketch camera change', async () => {
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const send = vi.spyOn(manager, 'sendSceneCommand').mockResolvedValue(null)
    await expect(
      enterSketchModeAndSyncCamera(manager, 'plane-id')
    ).rejects.toThrow('Camera command enable_sketch_mode was not acknowledged')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reports an unacknowledged camera command when the connection times out', async () => {
    const manager = makeConnectionManager({ width: 256, height: 256 })
    // The transport can resolve timeout strings despite its SDK response type.
    Object.defineProperty(manager, 'sendSceneCommand', {
      value: vi
        .fn()
        .mockResolvedValue('sendCommand rejected, you hit the timeout'),
    })
    await expect(
      enterSketchModeAndSyncCamera(manager, 'plane-id')
    ).rejects.toThrow('Camera command enable_sketch_mode was not acknowledged')
  })
})

describe('camera frame ownership', () => {
  afterEach(() => vi.useRealTimers())

  it.each([true, false])(
    'applies an authoritative ortho=%s response locally without echoing commands',
    async (ortho) => {
      vi.useFakeTimers()
      const { manager, controls, settingsSubscription } = makeCameraControls()
      controls.camera = ortho
        ? new PerspectiveCamera()
        : new OrthographicCamera()
      controls.syncDirection = 'clientToEngine'
      const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
      const changed = vi.fn()
      const reactChanged = vi.fn()
      controls.cameraChange.add(changed)
      controls.setReactCameraPropertiesCallback(reactChanged)
      settingsSubscription.callback({
        type: 'default_camera_get_settings',
        data: {
          settings: {
            ...cameraSettingsResponse.data.settings,
            ortho,
          },
        },
      })
      await vi.advanceTimersByTimeAsync(20)
      expect(controls.camera).toBeInstanceOf(
        ortho ? OrthographicCamera : PerspectiveCamera
      )
      expect(controls.camera.position).toEqual(new Vector3(0, 0, 10))
      expect(send).not.toHaveBeenCalled()
      expect(changed).toHaveBeenCalledOnce()
      expect(reactChanged).toHaveBeenCalledOnce()
    }
  )

  it('retains a client camera write already queued when an engine response arrives', async () => {
    vi.useFakeTimers()
    const { manager, controls, settingsSubscription } = makeCameraControls()
    controls.syncDirection = 'clientToEngine'
    controls.camera.position.set(1, 2, 3)
    controls.target.set(4, 5, 6)
    controls.onCameraChange()
    const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
    settingsSubscription.callback(cameraSettingsResponse)
    await vi.advanceTimersByTimeAsync(20)
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'default_camera_look_at',
          vantage: { x: 1, y: 2, z: 3 },
          center: { x: 4, y: 5, z: 6 },
        }),
      })
    )
  })

  it('still sends explicitly requested client projection changes', async () => {
    vi.useFakeTimers()
    const { manager, controls } = makeCameraControls()
    const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
    await controls.setCameraProjection('orthographic')
    await controls.setCameraProjection('perspective')
    expect(
      send.mock.calls.map(([command]) =>
        command.type === 'modeling_cmd_req' ? command.cmd.type : command.type
      )
    ).toEqual([
      'default_camera_set_orthographic',
      'default_camera_set_perspective',
    ])
  })

  it('sends the latest rapid camera change on the next frame without a trailing timer', () => {
    vi.useFakeTimers()
    const { manager, controls } = makeCameraControls()
    controls.syncDirection = 'clientToEngine'
    controls.onCameraChange()
    vi.advanceTimersToNextFrame()
    const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
    const cameraChanged = vi.fn()
    controls.setReactCameraPropertiesCallback(cameraChanged)

    controls.camera.position.set(1, 0, 10)
    controls.onCameraChange()
    controls.camera.position.set(2, 0, 10)
    controls.onCameraChange()
    vi.advanceTimersToNextFrame()

    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'default_camera_look_at',
          vantage: new Vector3(2, 0, 10),
        }),
      })
    )
    expect(cameraChanged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ position: [2, 0, 10] })
    )
    vi.advanceTimersByTime(500)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not publish queued camera work after control returns to the engine', () => {
    vi.useFakeTimers()
    const { manager, controls } = makeCameraControls()
    controls.syncDirection = 'clientToEngine'
    controls.onCameraChange()
    vi.advanceTimersToNextFrame()
    const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
    const cameraChanged = vi.fn()
    controls.setReactCameraPropertiesCallback(cameraChanged)

    controls.onCameraChange()
    controls.syncDirection = 'engineToClient'
    vi.advanceTimersByTime(500)

    expect(send).not.toHaveBeenCalled()
    expect(cameraChanged).not.toHaveBeenCalled()
  })

  it('flushes the final drag movement before ending the gesture and never sends it afterward', () => {
    vi.useFakeTimers()
    const canvas = makeCanvas(256, 256)
    Object.defineProperties(canvas, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
    })
    const { manager, controls } = makeCameraControls(canvas)
    vi.advanceTimersToNextFrame()
    const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
    vi.spyOn(controls, 'getInteractionType').mockReturnValue('pan')

    controls.onMouseDown(new PointerEvent('pointerdown', { clientX: 10 }))
    controls.onMouseMove(new PointerEvent('pointermove', { clientX: 20 }))
    controls.onMouseUpInner(new PointerEvent('pointerup', { clientX: 20 }))
    vi.advanceTimersToNextFrame()

    expect(
      send.mock.calls.map(([command]) =>
        command.type === 'modeling_cmd_req' ? command.cmd.type : null
      )
    ).toEqual(['camera_drag_start', 'camera_drag_move', 'camera_drag_end'])
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

  it('aligns once using the existing eye distance, without the engine moving the camera', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { manager, controls, sendSceneCommand } = setup()
    const sketch = new Group()
    sketch.position.set(200, 300, 400)
    sketch.rotateX(Math.PI / 2)
    const expectedDistance = controls.camera.position.distanceTo(
      sketch.position
    )
    const expectedHalfHeight = expectedDistance * Math.tan(Math.PI / 8)
    await enterSketchModeAndSyncCamera(manager, 'plane-id', controls)
    await controls.transitionToSketch(sketch)

    expect(commandsBesidesCameraPushes(sendSceneCommand)).toEqual([
      'enable_sketch_mode',
    ])
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
    expect(commandsBesidesCameraPushes(sendSceneCommand)).toEqual([
      'enable_sketch_mode',
      'sketch_mode_disable',
    ])
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

  it.each([1, 25.4, 1000])(
    'uses the engine face centre in millimetres with a scene scale of %d',
    async (scale) => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }))
      const { manager, controls, sendSceneCommand } = setup()
      const scene = new Group()
      scene.scale.setScalar(scale)
      const sketch = new Group()
      scene.add(sketch)
      await enterSketchModeAndSyncCamera(manager, 'face-id', controls, true)
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
      expect(sendSceneCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: { type: 'face_get_center', object_id: 'face-id' },
        })
      )
      // Engine face centres are already in world millimetres, unlike sketch coordinates.
      expect(controls.target.toArray()).toEqual([10, 20, 30])
      expect(
        controls.camera.quaternion.angleTo(sketch.quaternion)
      ).toBeLessThan(1e-8)
    }
  )

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

  it('does not apply a transition after its sketch actor is cancelled', async () => {
    const { controls } = setup()
    const abort = new AbortController()
    controls.requestSketchCameraTransition()
    abort.abort()
    await expect(controls.transitionToSketch(new Group(), abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(controls.camera).toBeInstanceOf(PerspectiveCamera)
  })

  it('does not queue a stale transition when sketch entry responds after cancellation', async () => {
    const { manager, controls, sendSceneCommand } = setup()
    let complete!: () => void
    sendSceneCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () => resolve(cameraAcknowledgement('enable_sketch_mode'))
        })
    )
    const entry = enterSketchModeAndSyncCamera(manager, 'plane-id', controls)
    controls.cancelSketchCameraTransition()
    complete()
    await entry
    await controls.transitionToSketch(new Group())
    expect(controls.camera).toBeInstanceOf(PerspectiveCamera)
  })
})

describe('reconnect camera capture', () => {
  const view = {
    eye_offset: 1,
    fov_y: 1,
    ortho_scale_enabled: true,
    ortho_scale_factor: 1,
    world_coord_system: 'right_handed_up_z' as const,
    is_ortho: true,
    pivot_position: { x: 1, y: 1, z: 1 },
    pivot_rotation: { x: 0, y: 0, z: 0, w: 1 },
  }

  function captureHarness() {
    const manager = makeConnectionManager({ width: 256, height: 256 })
    manager.connection = {
      websocket: { readyState: WebSocket.OPEN },
    } as ConnectionManager['connection']
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
    return { manager, controls }
  }

  it('stores the actual camera returned by the current connection', async () => {
    const { controls } = captureHarness()
    vi.spyOn(controls, 'getCameraView').mockResolvedValue(view)
    await controls.captureCameraForReconnect(new AbortController().signal)
    expect(controls.reconnectCameraState).toEqual(view)
  })

  it.each(['abort', 'replace'] as const)(
    'ignores a late response after %s',
    async (action) => {
      const { manager, controls } = captureHarness()
      let complete!: (value: typeof view) => void
      vi.spyOn(controls, 'getCameraView').mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve
          })
      )
      const controller = new AbortController()
      const capture = controls.captureCameraForReconnect(controller.signal)
      if (action === 'abort') controller.abort()
      else manager.connection = undefined
      complete(view)
      await capture
      expect(controls.reconnectCameraState).toBeUndefined()
    }
  )

  it('cancels only its camera request', async () => {
    const { manager, controls } = captureHarness()
    let reject!: (reason: Error) => void
    const sendSceneCommand = vi.spyOn(manager, 'sendSceneCommand')
    sendSceneCommand.mockImplementation(
      () =>
        new Promise((_, rejectRequest) => {
          reject = rejectRequest
        })
    )
    const rejectPendingCommand = vi.fn(() => reject(new Error('cancelled')))
    manager.rejectPendingCommand = rejectPendingCommand
    const controller = new AbortController()
    const request = controls.getCameraView(controller.signal)
    const rejected = expect(request).rejects.toThrow('cancelled')
    controller.abort()
    await rejected
    const command = sendSceneCommand.mock.calls[0][0]
    expect(command.type).toBe('modeling_cmd_req')
    if (command.type !== 'modeling_cmd_req') {
      throw new Error('Expected a modeling camera request')
    }
    expect(rejectPendingCommand).toHaveBeenCalledExactlyOnceWith({
      cmdId: command.cmd_id,
      message: 'Camera capture cancelled',
    })
  })
})

describe('hover queries', () => {
  afterEach(() => {
    document.getElementById('video-stream')?.remove()
  })

  function hoverQueriesSent(
    local: boolean,
    syncDirection: CameraControls['syncDirection']
  ) {
    const video = document.createElement('video')
    video.id = 'video-stream'
    document.body.append(video)
    const manager = makeConnectionManager({ width: 1024, height: 768 })
    const controls = new CameraControls(
      makeCanvas(1024, 768),
      manager,
      unusedSettings
    )
    controls.localCameraMode = local
    controls.syncDirection = syncDirection
    const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
    controls.onMouseMove(
      new PointerEvent('pointermove', {
        clientX: 100,
        clientY: 100,
        pointerType: 'mouse',
      })
    )
    return send.mock.calls.filter(
      ([command]) =>
        command.type === 'modeling_cmd_req' &&
        command.cmd.type === 'highlight_set_entity'
    )
  }

  it.each([true, false])(
    'are sent outside a sketch (local camera: %s)',
    (local) => {
      expect(hoverQueriesSent(local, 'engineToClient')).toHaveLength(1)
    }
  )

  it.each([true, false])(
    'are not sent while sketching (local camera: %s)',
    (local) => {
      expect(hoverQueriesSent(local, 'clientToEngine')).toHaveLength(0)
    }
  )
})

describe('local camera view restore', () => {
  function setup() {
    const manager = makeConnectionManager({ width: 1024, height: 768 })
    const controls = new CameraControls(
      makeCanvas(1024, 768),
      manager,
      unusedSettings
    )
    controls.localCameraMode = true
    return controls
  }

  // Looking straight down from 100 mm above the pivot. The engine's camera
  // looks along its local -Z, so no rotation means looking down the world Z.
  const view = (isOrtho: boolean): CameraViewState => ({
    pivot_rotation: { x: 0, y: 0, z: 0, w: 1 },
    pivot_position: { x: 10, y: 20, z: 0 },
    eye_offset: 100,
    fov_y: 30,
    is_ortho: isOrtho,
    ortho_scale_factor: 1.6,
    ortho_scale_enabled: true,
    world_coord_system: 'right_handed_up_z',
  })

  it('restores a perspective view onto an orthographic camera', async () => {
    const controls = setup()
    controls.useOrthographicCamera()
    await controls.setCameraView(view(false))
    expect(controls.camera).toBeInstanceOf(PerspectiveCamera)
    expect((controls.camera as PerspectiveCamera).fov).toBe(30)
    await expectViewRestored(controls, view(false))
  })

  it('restores an orthographic view onto a perspective camera', async () => {
    const controls = setup()
    await controls.setCameraView(view(true))
    expect(controls.camera).toBeInstanceOf(OrthographicCamera)
    expect(controls.lastPerspectiveFov).toBe(30)
    await expectViewRestored(controls, view(true))
  })
})

/** Placed as the engine places its camera, and read back as the same view. */
async function expectViewRestored(
  controls: CameraControls,
  view: CameraViewState
) {
  expect(controls.target.toArray()).toEqual([10, 20, 0])
  const position = controls.camera.position
  expect(position.x).toBeCloseTo(10)
  expect(position.y).toBeCloseTo(20)
  expect(position.z).toBeCloseTo(100)
  expect(controls.camera.getWorldDirection(new Vector3()).z).toBeCloseTo(-1)
  // The local renderer orients its camera from up, position and target.
  expect(controls.camera.up.distanceTo(new Vector3(0, 1, 0))).toBeCloseTo(0)

  const restored = await controls.getCameraView()
  if (restored instanceof Error) {
    throw restored
  }
  expect(restored.eye_offset).toBeCloseTo(view.eye_offset)
  expect({ ...restored, eye_offset: view.eye_offset }).toEqual(view)
}
