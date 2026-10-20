import type { WebSocketResponse } from '@kittycad/lib'
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
  type: 'default_camera_look_at' | 'enable_sketch_mode'
): WebSocketResponse {
  return {
    success: true,
    resp: { type: 'modeling', data: { modeling_response: { type, data: {} } } },
  }
}

const cameraSettingsResponse: WebSocketResponse = {
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
          },
        },
      },
    },
  },
}

describe('immediate camera changes', () => {
  afterEach(() => vi.useRealTimers())

  it('enters sketch mode without motion or a fixed wait, then awaits camera synchronization', async () => {
    vi.useFakeTimers()
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const enabled = promiseFactory<WebSocketResponse>()
    const synchronized = promiseFactory<WebSocketResponse>()
    const send = vi
      .spyOn(manager, 'sendSceneCommand')
      .mockImplementationOnce(() => enabled.promise)
      .mockImplementationOnce(() => synchronized.promise)
    let completed = false
    const entering = enterSketchModeAndSyncCamera(manager, 'plane-id').then(
      () => {
        completed = true
      }
    )
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        cmd: {
          type: 'enable_sketch_mode',
          adjust_camera: true,
          animated: false,
          ortho: true,
          entity_id: 'plane-id',
        },
      })
    )
    enabled.resolve(cameraAcknowledgement('enable_sketch_mode'))
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ cmd: { type: 'default_camera_get_settings' } })
    )
    expect(completed).toBe(false)
    synchronized.resolve(cameraSettingsResponse)
    await entering
    expect(completed).toBe(true)
  })

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
    vi.spyOn(controls, 'throttledUpdateEngineCamera').mockImplementation(
      () => {}
    )
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
      })
    )
    updated.resolve(cameraAcknowledgement('default_camera_look_at'))
    await change
    expect(send).toHaveBeenCalledTimes(1)
  })

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
