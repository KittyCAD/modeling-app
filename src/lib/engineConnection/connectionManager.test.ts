import { Themes } from '@src/lib/theme'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { Connection } from '@src/lib/engineConnection/connection'
import {
  EngineConnectionManagerEvents,
  type EngineDisconnectEventDetail,
} from '@src/lib/engineConnection/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

class ReconnectTestWebSocket extends EventTarget {
  static OPEN = 1
  static CLOSED = 3
  static instances: ReconnectTestWebSocket[] = []
  readyState = ReconnectTestWebSocket.OPEN
  binaryType: BinaryType = 'blob'
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 2
  })

  constructor(readonly url: string) {
    super()
    ReconnectTestWebSocket.instances.push(this)
  }

  finishClose(code: number) {
    this.readyState = ReconnectTestWebSocket.CLOSED
    this.dispatchEvent(new CloseEvent('close', { code }))
  }
}

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
    kclVersion: '3.0-preview',
    width,
    height,
    token: 'token',
    setStreamIsReady: vi.fn(),
  })
}

describe('ConnectionManager', () => {
  it('reopens lightweight sessions for a new entrypoint version', async () => {
    const manager = createConnectionManager()
    manager.started = true
    manager.connection = {
      isUsingUnitTestingConnection: true,
      kclVersion: '2.0',
      unitTestGeometryOnly: true,
      token: 'token',
      disconnectAll: vi.fn(),
    } as unknown as Connection
    const start = vi
      .spyOn(manager, 'start')
      .mockImplementation(async (options) => {
        options.callbackOnUnitTestingConnection?.('auth success')
      })
    expect(await manager.ensureUnitTestingKclVersion('3.0-preview')).toBe(true)
    expect(start).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kclVersion: '3.0-preview',
        token: 'token',
        unitTestGeometryOnly: true,
      })
    )
  })

  it('keeps a lightweight session when its version matches', async () => {
    const manager = createConnectionManager()
    manager.connection = {
      isUsingUnitTestingConnection: true,
      kclVersion: '2.0',
    } as unknown as Connection
    const start = vi.spyOn(manager, 'start')
    expect(await manager.ensureUnitTestingKclVersion('2.0')).toBe(false)
    expect(start).not.toHaveBeenCalled()
  })

  it.each(['1.0', '2.0', '3.0-preview'] as const)(
    'sends the entrypoint version %s in the browser handshake',
    (kclVersion) => {
      vi.stubGlobal('WebSocket', ReconnectTestWebSocket)
      const manager = createConnectionManager()
      vi.spyOn(manager, 'settings', 'get').mockReturnValue({
        enableSSAO: true,
        showScaleGrid: true,
        theme: Themes.Dark,
        highlightEdges: true,
        cameraProjection: 'perspective',
        cameraOrbit: 'spherical',
        backfaceColor: '#ffffff',
      })
      const connection = new Connection({
        url: manager.generateWebsocketURL(kclVersion),
        kclVersion,
        token: 'token',
        handleOnDataChannelMessage: vi.fn(),
        tearDownManager: vi.fn(),
        rejectPendingCommand: vi.fn(),
        handleMessage: vi.fn(),
        getCloudProjectId: () => undefined,
      })
      connection.deferredSdpAnswer = {
        promise: Promise.resolve(),
        resolve: vi.fn(),
        reject: vi.fn(),
      }
      connection.createWebSocketConnection()
      const url = new URL(ReconnectTestWebSocket.instances[0].url)
      expect(url.searchParams.get('kcl_version')).toBe(kclVersion)
      expect(url.searchParams.get('video_res_width')).toBe('256')
      expect(url.searchParams.get('post_effect')).toBe('ssao')
      expect(url.searchParams.get('show_grid')).toBe('true')
    }
  )

  it('reports a pong timeout separately from a WebSocket close', () => {
    const manager = createConnectionManager()
    const onPingPongTimeout = vi.fn()
    manager.started = true
    manager.connection = {
      disconnectAll: vi.fn(),
    } as unknown as NonNullable<ConnectionManager['connection']>
    manager.addEventListener(
      EngineConnectionManagerEvents.pingPongTimeout,
      onPingPongTimeout
    )

    manager.tearDown({ pingPongTimeout: true })

    expect(onPingPongTimeout).toHaveBeenCalledOnce()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    ReconnectTestWebSocket.instances = []
  })

  it.each([1000, 1006])(
    'carries a reconnect request through socket closure %s and manager cleanup',
    (code) => {
      vi.stubGlobal('WebSocket', ReconnectTestWebSocket)
      const manager = createConnectionManager()
      const closeDetails: EngineDisconnectEventDetail[] = []
      manager.addEventListener(
        EngineConnectionManagerEvents.WebsocketClosed,
        (event) => {
          if (event instanceof CustomEvent) closeDetails.push(event.detail)
        }
      )
      const connection = new Connection({
        kclVersion: '3.0-preview',
        url: 'ws://localhost/modeling-test',
        token: 'test-token',
        handleOnDataChannelMessage: vi.fn(),
        tearDownManager: manager.tearDown.bind(manager),
        rejectPendingCommand: vi.fn(),
        handleMessage: vi.fn(),
        getCloudProjectId: () => undefined,
      })
      connection.deferredSdpAnswer = {
        promise: Promise.resolve(),
        resolve: vi.fn(),
        reject: vi.fn(),
      }
      manager.connection = connection
      manager.started = true
      const rejectPending = vi.spyOn(manager, 'rejectAllPendingCommands')
      connection.createWebSocketConnection()
      const socket = ReconnectTestWebSocket.instances[0]
      const notice = JSON.stringify({
        success: true,
        request_id: null,
        resp: { type: 'reconnect', data: {} },
      })
      socket.dispatchEvent(new MessageEvent('message', { data: notice }))
      socket.dispatchEvent(new MessageEvent('message', { data: notice }))
      expect(socket.close).toHaveBeenCalledExactlyOnceWith(
        1000,
        'reconnect requested'
      )
      expect(closeDetails).toEqual([])

      socket.finishClose(code)
      expect(closeDetails).toEqual([
        { code: String(code), reconnectRequested: true },
      ])
      expect(rejectPending).toHaveBeenCalledOnce()
      expect(manager.connection).toBeUndefined()
      expect(manager.started).toBe(false)

      // Stale events on the retired socket must not start another recovery.
      socket.finishClose(code)
      socket.dispatchEvent(new MessageEvent('message', { data: notice }))
      expect(closeDetails).toHaveLength(1)
      expect(socket.close).toHaveBeenCalledOnce()
    }
  )

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
})
