import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  EngineConnectionErrorKind,
  EngineConnectionManagerEvents,
} from '@src/lib/engineConnection/utils'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { describe, expect, it, vi } from 'vitest'

function createConnectionManager() {
  return new ConnectionManager({
    settingsActor: {
      getSnapshot: () => ({ context: {} }),
    } as unknown as SettingsActorType,
  })
}

function startConnectionManager(
  manager: ConnectionManager,
  { width, height }: { width: number; height: number }
) {
  return manager.start({
    width,
    height,
    token: 'token',
    setStreamIsReady: vi.fn(),
  })
}

describe('ConnectionManager', () => {
  it.each([
    [{ width: 240, height: 256 }, 'width must be between 256 and 2160, 240'],
    [{ width: 256, height: 240 }, 'height must be between 256 and 2160, 240'],
    [{ width: 258, height: 256 }, 'width must be a multiple of 4, 258'],
    [{ width: Number.NaN, height: 256 }, 'width must be finite, NaN'],
  ])(
    'rejects unsupported stream dimensions before mutating connection state',
    async (dimensions, errorMessage) => {
      const manager = createConnectionManager()
      const rejectAllPendingCommands = vi.spyOn(
        manager,
        'rejectAllPendingCommands'
      )

      await expect(startConnectionManager(manager, dimensions)).rejects.toThrow(
        errorMessage
      )

      expect(manager.started).toBe(false)
      expect(manager.connection).toBeUndefined()
      expect(rejectAllPendingCommands).not.toHaveBeenCalled()
    }
  )

  it('does not send unsupported resize dimensions', async () => {
    const manager = createConnectionManager()
    const send = vi.fn()
    manager.connection = {
      deferredConnection: { promise: Promise.resolve() },
      send,
    } as unknown as NonNullable<ConnectionManager['connection']>

    await expect(
      manager.handleResize({ width: 256, height: 240 })
    ).rejects.toThrow('height must be between 256 and 2160, 240')

    expect(manager.streamDimensions).toEqual({ width: 256, height: 256 })
    expect(send).not.toHaveBeenCalled()
  })

  it('includes classified connection errors in websocket close events', () => {
    const manager = createConnectionManager()
    const onWebsocketClose = vi.fn()
    const connectionError = {
      kind: EngineConnectionErrorKind.BackendDisconnect,
      message: 'backend disconnected',
      terminal: true,
    }
    manager.addEventListener(
      EngineConnectionManagerEvents.WebsocketClosed,
      onWebsocketClose
    )

    manager.tearDown({
      websocketClosed: true,
      code: '1011',
      connectionError,
    })

    expect(onWebsocketClose).toHaveBeenCalledOnce()
    expect(onWebsocketClose.mock.calls[0][0]).toMatchObject({
      detail: {
        code: '1011',
        connectionError,
      },
    })
  })

  it('preserves a classified connection error for peer failures', () => {
    const manager = createConnectionManager()
    const onPeerConnectionFailed = vi.fn()
    const connectionError = {
      kind: EngineConnectionErrorKind.BackendDisconnect,
      message: 'backend disconnected',
      terminal: true,
    }
    manager.connection = {
      connectionError,
      disconnectAll: vi.fn(),
    } as unknown as NonNullable<ConnectionManager['connection']>
    manager.addEventListener(
      EngineConnectionManagerEvents.peerConnectionFailed,
      onPeerConnectionFailed
    )

    manager.tearDown({ peerConnectionFailed: true })

    expect(onPeerConnectionFailed).toHaveBeenCalledOnce()
    expect(onPeerConnectionFailed.mock.calls[0][0]).toMatchObject({
      detail: { connectionError },
    })
  })
})
