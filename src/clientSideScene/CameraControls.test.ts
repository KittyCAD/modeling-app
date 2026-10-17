import { CameraControls } from '@src/clientSideScene/CameraControls'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { getDimensions } from '@src/lib/engineConnection/utils'
import { OrthographicCamera, PerspectiveCamera } from 'three'
import { describe, expect, it, vi } from 'vitest'

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
    subscribeTo: vi.fn(() => vi.fn()),
    subscribeToUnreliable: vi.fn(() => vi.fn()),
  } as unknown as ConnectionManager
}

function unusedSettings(): never {
  throw new Error('Settings are not used by viewport projection updates')
}

describe('camera view handoff', () => {
  it.each(['perspective', 'orthographic'] as const)(
    'copies a %s view without sharing mutable state or sending engine commands',
    (projection) => {
      const manager = makeConnectionManager({ width: 256, height: 256 })
      const source = new CameraControls(
        makeCanvas(256, 256),
        manager,
        unusedSettings
      )
      const destination = new CameraControls(
        makeCanvas(512, 256),
        manager,
        unusedSettings
      )
      try {
        source.camera =
          projection === 'perspective'
            ? new PerspectiveCamera(62, 1, 0.1, 1000)
            : new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
        source.camera.position.set(5, 6, 7)
        source.camera.quaternion.setFromAxisAngle(source.camera.up, 0.7)
        source.camera.zoom = 2
        source.target.set(1, 2, 3)
        source.lastPerspectiveFov = 62
        source.perspectiveFovBeforeOrtho = 62
        const sendCommand = vi.spyOn(manager, 'sendSceneCommand')
        sendCommand.mockClear()

        destination.copyViewFrom(source)

        expect(destination.engineCameraProjection).toBe(projection)
        expect(destination.camera.position.toArray()).toEqual([5, 6, 7])
        expect(
          destination.camera.quaternion.equals(source.camera.quaternion)
        ).toBe(true)
        expect(destination.camera.zoom).toBe(2)
        expect(destination.target.toArray()).toEqual([1, 2, 3])
        expect(destination.lastPerspectiveFov).toBe(62)
        expect(destination.perspectiveFovBeforeOrtho).toBe(62)
        expect(sendCommand).not.toHaveBeenCalled()
        source.camera.position.set(0, 0, 0)
        source.target.set(0, 0, 0)
        expect(destination.camera.position.toArray()).toEqual([5, 6, 7])
        expect(destination.target.toArray()).toEqual([1, 2, 3])
      } finally {
        source.dispose()
        destination.dispose()
      }
    }
  )
})

describe('camera view subscriptions', () => {
  it('unsubscribes movement callbacks without removing a newer subscriber', () => {
    const controls = new CameraControls(
      makeCanvas(256, 256),
      makeConnectionManager({ width: 256, height: 256 }),
      unusedSettings
    )
    const first = vi.fn()
    const second = vi.fn()
    const removeFirst = controls.setIsCamMovingCallback(first)
    const removeSecond = controls.setIsCamMovingCallback(second)
    removeFirst()
    controls['handleStart']()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledExactlyOnceWith(true, false)
    removeSecond()
    controls['handleEnd']()
    expect(second).toHaveBeenCalledTimes(1)
    controls.dispose()
  })

  it('unsubscribes camera properties callbacks without removing a newer subscriber', () => {
    const controls = new CameraControls(
      makeCanvas(256, 256),
      makeConnectionManager({ width: 256, height: 256 }),
      unusedSettings
    )
    const first = vi.fn()
    const second = vi.fn()
    const removeFirst = controls.setReactCameraPropertiesCallback(first)
    const removeSecond = controls.setReactCameraPropertiesCallback(second)
    removeFirst()
    controls.reactCameraPropertiesCallback(controls.reactCameraProperties)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    removeSecond()
    controls.reactCameraPropertiesCallback(controls.reactCameraProperties)
    expect(second).toHaveBeenCalledTimes(1)
    controls.dispose()
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

describe('editor camera lifetime', () => {
  it('cancels pending engine subscriptions when closed before startup', () => {
    vi.useFakeTimers()
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const subscribe = vi.spyOn(manager, 'subscribeTo')
    const subscribeUnreliable = vi.spyOn(manager, 'subscribeToUnreliable')
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
    try {
      controls.dispose()
      vi.runOnlyPendingTimers()
      expect(subscribe).not.toHaveBeenCalled()
      expect(subscribeUnreliable).not.toHaveBeenCalled()
    } finally {
      controls.dispose()
      vi.useRealTimers()
    }
  })

  it('unsubscribes each engine camera callback once and ignores queued camera writes', () => {
    vi.useFakeTimers()
    const manager = makeConnectionManager({ width: 256, height: 256 })
    const unsubscribe = vi.fn()
    const subscribe = vi
      .spyOn(manager, 'subscribeTo')
      .mockReturnValue(unsubscribe)
    const subscribeUnreliable = vi
      .spyOn(manager, 'subscribeToUnreliable')
      .mockReturnValue(unsubscribe)
    const send = vi.spyOn(manager, 'sendSceneCommand')
    const controls = new CameraControls(
      makeCanvas(256, 256),
      manager,
      unusedSettings
    )
    try {
      vi.runOnlyPendingTimers()
      expect(subscribe).toHaveBeenCalledTimes(3)
      expect(subscribeUnreliable).toHaveBeenCalledTimes(2)
      controls.dispose()
      controls.dispose()
      expect(unsubscribe).toHaveBeenCalledTimes(5)
      send.mockClear()
      controls.throttledEngCmd({
        type: 'modeling_cmd_req',
        cmd_id: 'closed',
        cmd: { type: 'default_camera_get_settings' },
      })
      vi.runOnlyPendingTimers()
      expect(send).not.toHaveBeenCalled()
    } finally {
      controls.dispose()
      vi.useRealTimers()
    }
  })
})
