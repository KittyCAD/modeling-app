import {
  CameraControls,
  letEngineAnimateAndSyncCamAfter,
} from '@src/clientSideScene/CameraControls'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { getDimensions } from '@src/lib/engineConnection/utils'
import {
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import * as TWEEN from '@tweenjs/tween.js'

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

describe('sketch camera readiness', () => {
  it('finishes an already aligned camera without a safety timer', async () => {
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
    const animate = vi.spyOn(controls, 'tweenCameraToQuaternion')
    const send = vi.spyOn(manager, 'sendSceneCommand')
    await letEngineAnimateAndSyncCamAfter(manager, 'plane-id', {
      camControls: controls,
      isAnimating: false,
      animate: vi.fn(),
      stop: vi.fn(),
    })
    expect(animate).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'enable_sketch_mode',
          animated: false,
        }),
      })
    )
    expect(controls.syncDirection).toBe('clientToEngine')
  })
})

it.each([false, true])(
  'completes a sketch camera turn with animation frames (existing loop: %s)',
  async (existingLoop) => {
    vi.useFakeTimers({
      toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'],
    })
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
    controls.camera.position.set(5, -5, 5)
    const target = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI / 2
    )
    vi.spyOn(manager, 'sendSceneCommand').mockImplementation(
      async (command) => {
        if (
          command.type === 'modeling_cmd_req' &&
          command.cmd.type === 'default_camera_get_settings'
        ) {
          controls.camera.quaternion.copy(target)
        }
        return null
      }
    )
    let frame = -1
    const update = () => {
      TWEEN.update()
      frame = requestAnimationFrame(update)
    }
    const stop = vi.fn(() => cancelAnimationFrame(frame))
    if (existingLoop) update()
    try {
      const completed = vi.fn()
      const ready = letEngineAnimateAndSyncCamAfter(manager, 'plane-id', {
        camControls: controls,
        isAnimating: existingLoop,
        animate: update,
        stop,
      }).then(completed)
      await vi.advanceTimersByTimeAsync(100)
      expect(completed).not.toHaveBeenCalled()
      expect(controls.camera.quaternion.angleTo(target)).toBeGreaterThan(0)
      expect(controls.camera.quaternion.angleTo(target)).toBeLessThan(
        Math.PI / 2
      )
      await vi.advanceTimersByTimeAsync(450)
      await ready
      expect(controls.camera.quaternion.angleTo(target)).toBeLessThan(1e-6)
      expect(completed).toHaveBeenCalledOnce()
      expect(stop).toHaveBeenCalledTimes(existingLoop ? 0 : 1)
    } finally {
      cancelAnimationFrame(frame)
      TWEEN.removeAll()
      vi.useRealTimers()
    }
  }
)
