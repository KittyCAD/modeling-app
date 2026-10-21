import type { BatchResponse, WebSocketResponse } from '@kittycad/lib'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import {
  CameraControls,
  enterSketchModeAndSyncCamera,
} from '@src/clientSideScene/CameraControls'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { getDimensions } from '@src/lib/engineConnection/utils'
import { promiseFactory } from '@src/lib/utils'
import {
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

function cameraAcknowledgement(
  type:
    | 'default_camera_look_at'
    | 'default_camera_perspective_settings'
    | 'enable_sketch_mode'
): WebSocketResponse {
  return {
    success: true,
    resp: { type: 'modeling', data: { modeling_response: { type, data: {} } } },
  }
}

const cameraSettingsResponse = {
  success: true,
  resp: {
    type: 'modeling',
    data: {
      modeling_response: {
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
      },
    },
  },
} satisfies WebSocketResponse

function cameraBatchAcknowledgement(command: EngineCommand) {
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
    responses[cmd_id] = {
      response:
        cmd.type === 'default_camera_get_settings'
          ? cameraSettingsResponse.resp.data.modeling_response
          : { type: cmd.type, data: {} },
    }
  }
  return {
    success: true,
    request_id: command.batch_id,
    resp: { type: 'modeling_batch', data: { responses } },
  } satisfies WebSocketResponse
}

function makeSketchCamera() {
  const manager = makeConnectionManager({ width: 256, height: 256 })
  const subscriptions = vi.spyOn(manager, 'subscribeTo')
  const controls = new CameraControls(
    makeCanvas(256, 256),
    manager,
    unusedSettings
  )
  controls.camera = new OrthographicCamera(-10, 10, 10, -10)
  controls.camera.position.set(0, -10, 10)
  controls.syncDirection = 'clientToEngine'
  const settingsSubscription = subscriptions.mock.calls.find(
    ([{ event }]) => event === 'default_camera_get_settings'
  )?.[0]
  if (!settingsSubscription)
    expect.fail('Missing authoritative camera subscription')
  return { manager, controls, settingsSubscription }
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
        async (command) => {
          const reply = cameraBatchAcknowledgement(command)
          if (command.type !== 'modeling_cmd_batch_req')
            expect.fail('Expected a batch')
          const request = command.requests.find(({ cmd }) => cmd.type === type)
          if (!request) expect.fail('Expected the camera command')
          reply.resp.data.responses[request.cmd_id] = {
            errors: [{ error_code: 'bad_request', message: `${type} failed` }],
          }
          return reply
        }
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
        async (command) => {
          const reply = cameraBatchAcknowledgement(command)
          if (command.type !== 'modeling_cmd_batch_req')
            expect.fail('Expected a batch')
          const request = command.requests[1]
          if (failure === 'missing')
            delete reply.resp.data.responses[request.cmd_id]
          else
            reply.resp.data.responses[request.cmd_id] = {
              response: { type: 'enable_sketch_mode', data: {} },
            }
          return reply
        }
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
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
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
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const subscriptions = vi.spyOn(manager, 'subscribeTo')
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
    controls.camera = new OrthographicCamera(-10, 10, 10, -10)
    controls.camera.position.set(0, -10, 10)
    controls.syncDirection = 'clientToEngine'
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
    const subscription = subscriptions.mock.calls.find(
      ([{ event }]) => event === 'default_camera_get_settings'
    )?.[0]
    if (!subscription)
      expect.fail('The camera must subscribe to engine settings')
    // The real manager dispatches successful subscribed replies before it
    // resumes the awaiting camera helper.
    subscription.callback(cameraSettingsResponse.resp.data.modeling_response)
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
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
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
    vi.spyOn(manager, 'sendSceneCommand').mockImplementation(
      async (command) => {
        const reply = cameraBatchAcknowledgement(command)
        if (command.type !== 'modeling_cmd_batch_req')
          expect.fail('Expected batch')
        const index = command.requests.findIndex(({ cmd }) => cmd.type === type)
        const request = command.requests[index]
        if (!request) expect.fail('Missing exit command')
        reply.resp.data.responses[request.cmd_id] = {
          errors: [{ error_code: 'bad_request', message: `${type} failed` }],
        }
        for (const skipped of command.requests.slice(index + 1))
          delete reply.resp.data.responses[skipped.cmd_id]
        return reply
      }
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
            ...cameraSettingsResponse.resp.data.modeling_response,
            data: {
              settings: {
                ...cameraSettingsResponse.resp.data.modeling_response.data
                  .settings,
                ortho: failed,
                fov_y: 55,
                pos: { x: 9, y: 10, z: 11 },
                center: { x: 4, y: 5, z: 6 },
              },
            },
          }
          settingsSubscription.callback(response)
          return {
            success: true,
            resp: { type: 'modeling', data: { modeling_response: response } },
          }
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
        settingsSubscription.callback(
          cameraSettingsResponse.resp.data.modeling_response
        )
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
      const manager = makeConnectionManager({ width: 256, height: 256 })
      const subscriptions = vi.spyOn(manager, 'subscribeTo')
      const controls = new CameraControls(
        makeCanvas(256, 256),
        manager,
        unusedSettings
      )
      controls.camera = ortho
        ? new PerspectiveCamera()
        : new OrthographicCamera()
      controls.syncDirection = 'clientToEngine'
      const subscription = subscriptions.mock.calls.find(
        ([{ event }]) => event === 'default_camera_get_settings'
      )?.[0]
      if (!subscription)
        expect.fail('The real camera must subscribe to settings')
      const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
      const changed = vi.fn()
      const reactChanged = vi.fn()
      controls.cameraChange.add(changed)
      controls.setReactCameraPropertiesCallback(reactChanged)
      subscription.callback({
        type: 'default_camera_get_settings',
        data: {
          settings: {
            ...cameraSettingsResponse.resp.data.modeling_response.data.settings,
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
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const subscriptions = vi.spyOn(manager, 'subscribeTo')
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
    controls.syncDirection = 'clientToEngine'
    controls.camera.position.set(1, 2, 3)
    controls.target.set(4, 5, 6)
    controls.onCameraChange()
    const subscription = subscriptions.mock.calls.find(
      ([{ event }]) => event === 'default_camera_get_settings'
    )?.[0]
    if (!subscription) expect.fail('The real camera must subscribe to settings')
    const send = vi.spyOn(manager, 'sendSceneCommand').mockClear()
    subscription.callback(cameraSettingsResponse.resp.data.modeling_response)
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
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
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
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
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
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
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
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const controls = new CameraControls(canvas, manager, unusedSettings)
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
