const reportClientError = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return { ...actual, reportClientError }
})

import type * as ClientErrorsModule from '@src/lib/clientErrors'
import {
  EXECUTE_AST_INTERRUPT_ERROR_MESSAGE,
  PENDING_COMMAND_TIMEOUT,
} from '@src/lib/constants'
import { EngineDebugger } from '@src/lib/debugger'
import { Connection } from '@src/lib/engineConnection/connection'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  EngineConnectionManagerEvents,
  type EngineDisconnectEventDetail,
} from '@src/lib/engineConnection/utils'
import type { SettingsActorType } from '@src/machines/settingsMachine'
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

  constructor() {
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
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    reportClientError.mockClear()
    ReconnectTestWebSocket.instances = []
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

  function reconnectHarness() {
    const manager = createConnectionManager()
    addConnectedState(manager)
    const connection = manager.connection!
    const close = vi.fn()
    connection.closeForReconnect = close
    connection.send = vi.fn()
    const requestReconnect = () =>
      manager['handleReconnectRequested'](connection)
    const sendCommand = (id: string, scene = false) =>
      manager.sendCommand(
        id,
        {
          command: {
            type: 'modeling_cmd_req',
            cmd_id: id,
            cmd: { type: 'scene_clear_all' },
          },
          range: [0, 0, 0],
          idToRangeMap: {},
        },
        scene
      )
    return { manager, connection, close, requestReconnect, sendCommand }
  }

  it('waits through command-free gaps until every execution finishes', () => {
    const { manager, close, requestReconnect } = reconnectHarness()
    const finishFirst = manager.trackExecution()
    const finishSecond = manager.trackExecution()
    requestReconnect()
    expect(manager.isReconnectPending).toBe(true)
    expect(close).not.toHaveBeenCalled()
    finishFirst()
    finishFirst()
    expect(close).not.toHaveBeenCalled()
    finishSecond()
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'waits for command settlement (rejected=%s)',
    async (rejected) => {
      vi.useFakeTimers()
      const { manager, close, requestReconnect, sendCommand } =
        reconnectHarness()
      const finish = manager.trackExecution()
      const result = sendCommand('pending').catch(() => undefined)
      requestReconnect()
      finish()
      expect(close).not.toHaveBeenCalled()
      if (rejected) {
        manager.rejectPendingCommand({ cmdId: 'pending' })
      } else {
        manager.createMessageHandler()(
          new MessageEvent('message', {
            data: JSON.stringify({
              success: true,
              request_id: 'pending',
              resp: {
                type: 'modeling',
                data: {
                  modeling_response: { type: 'scene_clear_all', data: {} },
                },
              },
            }),
          })
        )
      }
      await result
      expect(manager.pendingCommands).toEqual({})
      expect(close).toHaveBeenCalledOnce()
    }
  )

  it('releases a timed-out command so reconnect can proceed', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { manager, close, requestReconnect, sendCommand } = reconnectHarness()
    const result = sendCommand('timeout').catch(() => undefined)
    requestReconnect()
    expect(close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(PENDING_COMMAND_TIMEOUT)
    await result
    expect(manager.pendingCommands).toEqual({})
    expect(close).toHaveBeenCalledOnce()
  })

  it('waits for every recovery even when the original execution finishes', () => {
    const { manager, close, requestReconnect } = reconnectHarness()
    const finish = manager.trackExecution()
    const recoverFirst = manager.captureFailedExecutionCleanup()
    const recoverSecond = manager.captureFailedExecutionCleanup()
    requestReconnect()
    finish()
    recoverFirst()
    recoverFirst()
    expect(close).not.toHaveBeenCalled()
    recoverSecond()
    expect(close).toHaveBeenCalledOnce()
  })

  it('recovery preserves scene commands and newer work', async () => {
    vi.useFakeTimers()
    const { manager, close, requestReconnect, sendCommand } = reconnectHarness()
    manager.trackExecution()
    const failed = sendCommand('failed').catch(() => undefined)
    const scene = sendCommand('scene', true).catch(() => undefined)
    const recover = manager.captureFailedExecutionCleanup()
    const finishNew = manager.trackExecution()
    const newer = sendCommand('new').catch(() => undefined)
    requestReconnect()
    recover()
    await failed
    expect(Object.keys(manager.pendingCommands).sort()).toEqual([
      'new',
      'scene',
    ])
    expect(close).not.toHaveBeenCalled()
    manager.rejectPendingCommand({ cmdId: 'new' })
    manager.rejectPendingCommand({ cmdId: 'scene' })
    await Promise.all([scene, newer])
    expect(close).not.toHaveBeenCalled()
    finishNew()
    expect(close).toHaveBeenCalledOnce()
  })

  it('ignores execution and recovery completions after teardown', () => {
    const { manager, connection, close, requestReconnect } = reconnectHarness()
    const finish = manager.trackExecution()
    const recover = manager.captureFailedExecutionCleanup()
    requestReconnect()
    manager.tearDown({ route: 'window-offline', initiatedBy: 'client' })
    addConnectedState(manager)
    const newClose = vi.fn()
    manager.connection!.closeForReconnect = newClose
    finish()
    recover()
    manager['handleReconnectRequested'](connection)
    expect(manager.isReconnectPending).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(newClose).not.toHaveBeenCalled()
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
        onReconnectRequested: manager['handleReconnectRequested'].bind(manager),
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
