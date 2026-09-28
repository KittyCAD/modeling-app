import {
  CameraControls,
  type CameraStateSnapshot,
} from '@src/clientSideScene/CameraControls'
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
  const sendSceneCommand = vi.fn().mockResolvedValue(undefined)
  const manager = {
    streamDimensions,
    sendSceneCommand,
    subscribeTo: vi.fn(),
    subscribeToUnreliable: vi.fn(),
  } as unknown as ConnectionManager
  return { manager, sendSceneCommand }
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
    const { manager } = makeConnectionManager(delayedStreamDimensions)
    const controls = new CameraControls(
      makeCanvas(displayDimensions.width, displayDimensions.height),
      manager,
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

describe('CameraControls reconnect state', () => {
  it('captures an immutable perspective view and restores it to the Engine', async () => {
    const { manager: engineCommandManager, sendSceneCommand } =
      makeConnectionManager({
        width: 1200,
        height: 800,
      })
    const controls = new CameraControls(
      makeCanvas(1200, 800),
      engineCommandManager,
      unusedSettings
    )
    controls.camera.position.set(10, 20, 30)
    controls.target.set(1, 2, 3)
    ;(controls.camera as PerspectiveCamera).fov = 37

    controls.captureCameraStateBeforeReconnect()
    const snapshot = controls.cameraStateBeforeReconnect as CameraStateSnapshot
    controls.camera.position.set(100, 200, 300)
    controls.target.set(4, 5, 6)
    controls.captureCameraStateBeforeReconnect()

    expect(controls.cameraStateBeforeReconnect).toBe(snapshot)
    expect(snapshot?.position.toArray()).toEqual([10, 20, 30])
    expect(snapshot?.target.toArray()).toEqual([1, 2, 3])

    sendSceneCommand.mockClear()
    await controls.restoreCameraState(snapshot)

    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'default_camera_perspective_settings',
          center: { x: 1, y: 2, z: 3 },
          vantage: { x: 10, y: 20, z: 30 },
          fov_y: 37,
        }),
      }),
      true
    )
    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cmd: { type: 'default_camera_get_settings' },
      })
    )
  })

  it('restores orthographic framing without overriding the active projection', async () => {
    const { manager: engineCommandManager, sendSceneCommand } =
      makeConnectionManager({
        width: 1200,
        height: 800,
      })
    const controls = new CameraControls(
      makeCanvas(1200, 800),
      engineCommandManager,
      unusedSettings
    )
    controls.useOrthographicCamera()
    controls.camera.position.set(0, 0, 100)
    controls.target.set(0, 0, 0)
    controls.camera.zoom = 2
    controls.perspectiveFovBeforeOrtho = 40
    const snapshot = controls.captureCameraState()

    sendSceneCommand.mockClear()
    await controls.restoreCameraState(snapshot)

    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'default_camera_perspective_settings',
          center: { x: 0, y: 0, z: 0 },
          vantage: expect.objectContaining({
            x: 0,
            y: 0,
            z: expect.closeTo(27.475, 3),
          }),
          fov_y: 40,
        }),
      }),
      true
    )
    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cmd: { type: 'default_camera_get_settings' },
      })
    )
    const commandTypes = sendSceneCommand.mock.calls.map(
      ([request]) => request.cmd.type
    )
    expect(commandTypes).not.toContain('default_camera_set_orthographic')
    expect(commandTypes).not.toContain('default_camera_set_perspective')
  })
})
