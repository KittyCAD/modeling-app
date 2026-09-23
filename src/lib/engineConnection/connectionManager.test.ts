const reportClientError = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return { ...actual, reportClientError }
})

import type * as ClientErrorsModule from '@src/lib/clientErrors'
import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { WebSocketResponse } from '@kittycad/lib'
import { EXECUTE_AST_INTERRUPT_ERROR_MESSAGE } from '@src/lib/constants'
import { EngineDebugger } from '@src/lib/debugger'
import { Connection } from '@src/lib/engineConnection/connection'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  EngineConnectionManagerEvents,
  type EngineDisconnectEventDetail,
} from '@src/lib/engineConnection/utils'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { Themes } from '@src/lib/theme'
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

  constructor(readonly url?: string | URL) {
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

function addConnectedState(manager: ConnectionManager) {
  manager.connection = {
    id: 'connection-1',
    apiCallId: 'api-call-1',
    connected: true,
    websocket: { readyState: WebSocket.OPEN },
    peerConnection: {
      connectionState: 'connected',
      iceConnectionState: 'connected',
    },
    unreliableDataChannel: { readyState: 'open' },
    deferredConnection: null,
    deferredMediaStreamAndWebrtcStatsCollector: null,
    deferredPeerConnection: null,
    deferredSdpAnswer: null,
    disconnectAll: vi.fn(),
  } as unknown as Connection
  manager.started = true
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
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    reportClientError.mockClear()
    ReconnectTestWebSocket.instances = []
  })

  describe('KCL language version', () => {
    const acknowledgement: [WebSocketResponse] = [
      {
        success: true,
        resp: {
          type: 'modeling',
          data: { modeling_response: { type: 'empty' } },
        },
      },
    ]

    it.each<KclVersion>(['1.0', '2.0', '3.0-preview'])(
      'sends %s in the connection URL and remembers it for this session',
      async (version) => {
        vi.stubGlobal('WebSocket', ReconnectTestWebSocket)
        const manager = createConnectionManager()
        vi.spyOn(manager, 'settings', 'get').mockReturnValue({
          theme: Themes.Light,
          highlightEdges: true,
          enableSSAO: true,
          showScaleGrid: true,
          cameraProjection: 'perspective',
          cameraOrbit: 'spherical',
          backfaceColor: '#ffffff',
        })
        await manager.start({
          width: 256,
          height: 256,
          token: 'token',
          setStreamIsReady: vi.fn(),
          callbackOnUnitTestingConnection: vi.fn(),
          kclVersion: version,
        })
        expect(
          new URL(manager.connection!.url).searchParams.get('kcl_version')
        ).toBe(version)
        expect(
          new URL(ReconnectTestWebSocket.instances[0].url!).searchParams.get(
            'kcl_version'
          )
        ).toBe(version)
        const send = vi
          .spyOn(manager, 'sendCommand')
          .mockResolvedValue(acknowledgement)
        await manager.setKclVersion(version)
        expect(send).not.toHaveBeenCalled()
        manager.tearDown({ route: 'service-disposed', initiatedBy: 'client' })
      }
    )

    it('sends changed versions over the reliable command path and skips confirmed duplicates', async () => {
      const manager = createConnectionManager()
      addConnectedState(manager)
      const send = vi
        .spyOn(manager, 'sendCommand')
        .mockResolvedValue(acknowledgement)
      for (const version of ['2.0', '2.0', '3.0-preview', '1.0'] as const) {
        await manager.setKclVersion(version)
      }
      expect(send.mock.calls.map(([, { command }]) => command)).toEqual([
        expect.objectContaining({
          cmd: { type: 'set_kcl_version', kcl_version: '2.0' },
        }),
        expect.objectContaining({
          cmd: { type: 'set_kcl_version', kcl_version: '3.0-preview' },
        }),
        expect.objectContaining({
          cmd: { type: 'set_kcl_version', kcl_version: '1.0' },
        }),
      ])
    })

    it('does not trust the old version after a failed or interrupted change', async () => {
      const manager = createConnectionManager()
      addConnectedState(manager)
      const send = vi
        .spyOn(manager, 'sendCommand')
        .mockResolvedValue(acknowledgement)
      await manager.setKclVersion('2.0')
      send.mockRejectedValueOnce(new Error('interrupted'))
      await expect(manager.setKclVersion('3.0-preview')).rejects.toThrow(
        'interrupted'
      )
      await manager.setKclVersion('2.0')
      expect(send).toHaveBeenCalledTimes(3)
    })

    it('does not apply an old session acknowledgement to a replacement connection', async () => {
      const manager = createConnectionManager()
      addConnectedState(manager)
      const deferred = Promise.withResolvers<[WebSocketResponse]>()
      const send = vi
        .spyOn(manager, 'sendCommand')
        .mockReturnValueOnce(deferred.promise)
        .mockResolvedValue(acknowledgement)
      const pending = manager.setKclVersion('2.0')
      addConnectedState(manager)
      deferred.resolve(acknowledgement)
      await expect(pending).rejects.toThrow()
      await manager.setKclVersion('2.0')
      expect(send).toHaveBeenCalledTimes(2)
    })

    it('resends the version after teardown and reconnect', async () => {
      const manager = createConnectionManager()
      addConnectedState(manager)
      const send = vi
        .spyOn(manager, 'sendCommand')
        .mockResolvedValue(acknowledgement)
      await manager.setKclVersion('2.0')
      manager.tearDown({ route: 'service-disposed', initiatedBy: 'client' })
      addConnectedState(manager)
      await manager.setKclVersion('2.0')
      expect(send).toHaveBeenCalledTimes(2)
    })

    it('rejects version changes while disconnected', async () => {
      const manager = createConnectionManager()
      const send = vi.spyOn(manager, 'sendCommand')
      await expect(manager.setKclVersion('2.0')).rejects.toThrow()
      expect(send).not.toHaveBeenCalled()
    })
  })

  it('warns when Engine rejects a modeling command', async () => {
    const manager = createConnectionManager()
    manager.connection = {} as Connection
    const rejection = [
      {
        success: false,
        errors: [
          { error_code: 'internal_api', message: 'Engine queue is full' },
        ],
      },
    ]
    vi.spyOn(manager, 'sendCommand').mockRejectedValue(rejection)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      manager.sendModelingCommandFromWasm('command-1', '{}', '{}', '{}')
    ).rejects.toBe(JSON.stringify(rejection[0]))

    expect(warn).toHaveBeenCalledExactlyOnceWith(rejection)
  })

  it('logs one intentional interrupt without reporting pending commands', async () => {
    const manager = createConnectionManager()
    manager.connection = { send: vi.fn() } as unknown as Connection
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const addLog = vi.spyOn(EngineDebugger, 'addLog')

    manager.fireModelingCommandFromWasm('command-1', '{}', '{}', '{}')
    const rejection = expect(
      manager.sendModelingCommandFromWasm('command-2', '{}', '{}', '{}')
    ).rejects.toContain('executionIsStale')

    manager.rejectAllModelingCommands(EXECUTE_AST_INTERRUPT_ERROR_MESSAGE)
    await rejection

    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(addLog).toHaveBeenCalledExactlyOnceWith({
      label: 'connectionManager',
      message: 'interrupting stale modeling execution',
      metadata: { pendingCommandCount: 2 },
    })
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
        url: 'ws://localhost/modeling-test',
        token: 'test-token',
        handleOnDataChannelMessage: vi.fn(),
        recordShutdownTrigger: manager.recordShutdownTrigger.bind(manager),
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
      expect(reportClientError).toHaveBeenCalledOnce()
      expect(reportClientError).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({
            shutdownRoute: 'websocket-closed',
            initiatedBy: 'api',
            websocketCloseCode: '1000',
            websocketCloseReason: 'reconnect requested',
            reconnectRequested: true,
          }),
        })
      )

      socket.finishClose(code)
      expect(closeDetails).toEqual([
        { code: String(code), reconnectRequested: true },
      ])
      expect(rejectPending).toHaveBeenCalledOnce()
      expect(manager.connection).toBeUndefined()
      expect(manager.started).toBe(false)
      expect(reportClientError).toHaveBeenCalledOnce()

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

  it('reports a locally initiated shutdown before clearing connection state', () => {
    const manager = createConnectionManager()
    addConnectedState(manager)

    manager.tearDown({ route: 'page-exit', initiatedBy: 'client' })

    expect(reportClientError).toHaveBeenCalledOnce()
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'engine_teardown',
        message: 'Engine teardown called: page-exit.',
        extra: expect.objectContaining({
          shutdownRoute: 'page-exit',
          initiatedBy: 'client',
          connectionId: 'connection-1',
          modelingApiCallId: 'api-call-1',
          connectionConnected: true,
          websocketReadyState: WebSocket.OPEN,
          peerConnectionState: 'connected',
          iceConnectionState: 'connected',
          dataChannelReadyState: 'open',
          pendingCommandCount: 0,
          sourceTime: expect.any(String),
          monotonicElapsedMs: expect.any(Number),
        }),
      })
    )
    expect(manager.connection).toBeUndefined()
  })

  it('reports an observed WebSocket close without guessing its initiator', () => {
    const manager = createConnectionManager()
    addConnectedState(manager)

    manager.tearDown({
      route: 'websocket-closed',
      initiatedBy: 'unknown',
      code: '1006',
      reason: 'connection lost',
    })

    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: expect.objectContaining({
          shutdownRoute: 'websocket-closed',
          initiatedBy: 'unknown',
          websocketCloseCode: '1006',
          websocketCloseReason: 'connection lost',
        }),
      })
    )
  })

  it('keeps the first shutdown trigger when a later callback races it', () => {
    const manager = createConnectionManager()
    addConnectedState(manager)

    manager.tearDown({ route: 'window-offline', initiatedBy: 'client' })
    manager.tearDown({
      route: 'websocket-closed',
      initiatedBy: 'unknown',
      code: '1006',
    })

    expect(reportClientError).toHaveBeenCalledOnce()
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: expect.objectContaining({
          shutdownRoute: 'window-offline',
          initiatedBy: 'client',
          websocketCloseCode: null,
        }),
      })
    )
  })
})
