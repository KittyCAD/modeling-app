const reportClientError = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return { ...actual, reportClientError }
})

import type * as ClientErrorsModule from '@src/lib/clientErrors'
import type {
  BatchResponse,
  WebSocketRequest,
  WebSocketResponse,
} from '@kittycad/lib'
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
import { createSettings } from '@src/lib/settings/initialSettings'
import { promiseFactory } from '@src/lib/utils'
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
      getSnapshot: () => ({ context: createSettings() }),
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
  return manager.connection
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

function sceneCameraBatch(
  responses = true
): Extract<WebSocketRequest, { type: 'modeling_cmd_batch_req' }> {
  return {
    type: 'modeling_cmd_batch_req',
    batch_id: 'scene-batch',
    responses,
    requests: [
      {
        cmd_id: 'enable',
        cmd: {
          type: 'enable_sketch_mode',
          entity_id: 'plane',
          animated: false,
          ortho: true,
          adjust_camera: true,
        },
      },
      { cmd_id: 'settings', cmd: { type: 'default_camera_get_settings' } },
    ],
  }
}

const sceneCameraBatchResponse = {
  success: true,
  request_id: 'scene-batch',
  resp: {
    type: 'modeling_batch',
    data: {
      responses: {
        // Deliberately reversed: callbacks must follow requests, not map order.
        settings: {
          response: {
            type: 'default_camera_get_settings',
            data: {
              settings: {
                center: { x: 0, y: 0, z: 0 },
                pos: { x: 0, y: 0, z: 10 },
                up: { x: 0, y: 1, z: 0 },
                orientation: { x: 0, y: 0, z: 0, w: 1 },
                ortho: true,
              },
            },
          },
        },
        enable: { response: { type: 'enable_sketch_mode', data: {} } },
      },
    },
  },
} satisfies WebSocketResponse

function message(response: WebSocketResponse) {
  return new MessageEvent('message', { data: JSON.stringify(response) })
}

function createTransport(manager: ConnectionManager) {
  return new Connection({
    url: 'ws://localhost/modeling-test',
    token: 'test-token',
    handleOnDataChannelMessage: vi.fn(),
    recordShutdownTrigger: manager.recordShutdownTrigger.bind(manager),
    tearDownManager: manager.tearDown.bind(manager),
    onReconnectRequested: vi.fn(),
    rejectPendingCommand: vi.fn(),
    handleMessage: vi.fn(),
    getCloudProjectId: () => undefined,
  })
}

function pendingStartup(manager: ConnectionManager) {
  const startup = startConnectionManager(manager, {
    width: 256,
    height: 256,
  }).catch((error: unknown) => error)
  const websocket = ReconnectTestWebSocket.instances.at(-1)
  if (!websocket) expect.fail('Expected the startup WebSocket')
  return { startup, websocket }
}

function pendingWasmCommand(manager: ConnectionManager, requestId: string) {
  const response = manager
    .sendModelingCommandFromWasm(
      requestId,
      '[0,0,0]',
      JSON.stringify({
        type: 'modeling_cmd_req',
        cmd_id: requestId,
        cmd: { type: 'begin_execution', enable_render: true },
      }),
      '{}'
    )
    .catch(() => undefined)
  const acknowledgement = message({
    success: true,
    request_id: requestId,
    resp: {
      type: 'modeling',
      data: { modeling_response: { type: 'empty' } },
    },
  })
  return { response, acknowledgement }
}

describe('ConnectionManager', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    reportClientError.mockClear()
    ReconnectTestWebSocket.instances = []
  })

  it('awaits a scene batch and delivers subscriptions once in request order before completion', async () => {
    vi.useFakeTimers()
    const manager = createConnectionManager()
    const connection = addConnectedState(manager)
    connection.send = vi.fn()
    const order: string[] = []
    manager.subscribeTo({
      event: 'enable_sketch_mode',
      callback: () => order.push('enable'),
    })
    manager.subscribeTo({
      event: 'default_camera_get_settings',
      callback: () => order.push('settings'),
    })
    const result = manager
      .sendSceneCommand(sceneCameraBatch())
      .then((response) => {
        order.push('complete')
        return response
      })
    expect(Object.keys(manager.pendingCommands)).toEqual(['scene-batch'])
    expect(manager.pendingCommands['scene-batch'].isSceneCommand).toBe(true)
    expect(order).toEqual([])
    const receive = manager.createMessageHandler()
    const event = message(sceneCameraBatchResponse)
    receive(event)
    expect(order).toEqual(['enable', 'settings'])
    expect(await result).toEqual(sceneCameraBatchResponse)
    expect(order).toEqual(['enable', 'settings', 'complete'])
    receive(event)
    expect(order).toEqual(['enable', 'settings', 'complete'])
    expect(
      manager.commandLogs.filter(({ type }) => type === 'receive-reliable')
    ).toHaveLength(2)
    expect(manager.pendingCommands).toEqual({})
  })

  it('keeps responses:false scene batches fire-and-forget without pending work', async () => {
    const manager = createConnectionManager()
    const connection = addConnectedState(manager)
    const send = vi.fn()
    connection.send = send
    const batch = sceneCameraBatch(false)
    expect(await manager.sendSceneCommand(batch)).toBeNull()
    expect(send).toHaveBeenCalledExactlyOnceWith(batch)
    expect(manager.pendingCommands).toEqual({})
  })

  it.each(['acknowledged', 'missing', 'failed'])(
    'waits for an %s object-visibility batch',
    async (outcome) => {
      vi.useFakeTimers()
      const manager = createConnectionManager()
      const connection = addConnectedState(manager)
      const send = vi.fn<(command: WebSocketRequest) => void>()
      connection.send = send
      const visibility = new Map([
        ['first-plane', true],
        ['second-plane', false],
      ])
      let settled = false
      const operation = manager.setObjectsHidden(visibility)
      void operation.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      const request = send.mock.calls[0]?.[0]
      expect(request?.type).toBe('modeling_cmd_batch_req')
      if (request?.type !== 'modeling_cmd_batch_req') {
        throw new Error('Expected an object-visibility batch')
      }
      expect(request.responses).toBe(true)
      expect(request.requests.map(({ cmd }) => cmd)).toEqual([
        { type: 'object_visible', object_id: 'first-plane', hidden: true },
        { type: 'object_visible', object_id: 'second-plane', hidden: false },
      ])
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(Object.keys(manager.pendingCommands)).toEqual([request.batch_id])

      const responses: Record<string, BatchResponse> = {}
      for (const [index, { cmd_id }] of request.requests.entries()) {
        if (index === 1 && outcome === 'missing') continue
        responses[cmd_id] =
          index === 1 && outcome === 'failed'
            ? {
                errors: [
                  { error_code: 'internal_api', message: 'Missing plane' },
                ],
              }
            : { response: { type: 'object_visible', data: {} } }
      }
      const response: WebSocketResponse = {
        success: true,
        request_id: request.batch_id,
        resp: { type: 'modeling_batch', data: { responses } },
      }
      const result =
        outcome === 'acknowledged'
          ? expect(operation).resolves.toBeUndefined()
          : expect(operation).rejects.toThrow(
              outcome === 'failed' ? 'Missing plane' : /not acknowledged/
            )
      manager.createMessageHandler()(message(response))
      await result
      expect(settled).toBe(true)
      expect(manager.pendingCommands).toEqual({})
    }
  )

  it('rejects a retired scene batch and ignores its late acknowledgement after replacement', async () => {
    vi.useFakeTimers()
    const manager = createConnectionManager()
    addConnectedState(manager).send = vi.fn()
    const callback = vi.fn()
    manager.subscribeTo({ event: 'default_camera_get_settings', callback })
    const receive = manager.createMessageHandler()
    const retired = manager.sendSceneCommand(sceneCameraBatch())
    const rejected = expect(retired).rejects.toMatchObject([
      { errors: [{ error_code: 'connection_problem' }] },
    ])
    manager.tearDown({ route: 'user-requested', initiatedBy: 'client' })
    await rejected
    addConnectedState(manager).send = vi.fn()
    const currentBatch = { ...sceneCameraBatch(), batch_id: 'new-scene-batch' }
    const current = manager.sendSceneCommand(currentBatch)
    receive(message(sceneCameraBatchResponse))
    expect(callback).not.toHaveBeenCalled()
    expect(Object.keys(manager.pendingCommands)).toEqual(['new-scene-batch'])
    receive(
      message({
        ...sceneCameraBatchResponse,
        request_id: currentBatch.batch_id,
      })
    )
    await current
    expect(callback).toHaveBeenCalledOnce()
    expect(manager.pendingCommands).toEqual({})
  })

  it('settles modeling responses before the WebRTC readiness handoff', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', ReconnectTestWebSocket)
    const manager = createConnectionManager()
    const { startup, websocket } = pendingStartup(manager)
    const requestId = '00000000-0000-4000-8000-000000000001'
    const { response, acknowledgement } = pendingWasmCommand(manager, requestId)

    try {
      expect(manager.connection?.connected).toBe(false)
      expect(Object.keys(manager.pendingCommands)).toEqual([requestId])
      websocket.dispatchEvent(acknowledgement)
      expect(Object.keys(manager.pendingCommands)).toEqual([])
      expect(await response).toBeInstanceOf(Uint8Array)
      expect(
        manager.commandLogs.filter(({ type }) => type === 'receive-reliable')
      ).toHaveLength(1)
    } finally {
      manager.tearDown({ route: 'user-requested', initiatedBy: 'client' })
      await Promise.all([response, startup])
    }
  })

  it('removes the early response listener before replacing its connection', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', ReconnectTestWebSocket)
    const manager = createConnectionManager()
    const { startup: firstStartup, websocket: retiredWebsocket } =
      pendingStartup(manager)
    manager.tearDown({ route: 'user-requested', initiatedBy: 'client' })
    await firstStartup

    const { startup, websocket } = pendingStartup(manager)
    const requestId = '00000000-0000-4000-8000-000000000002'
    const { response, acknowledgement } = pendingWasmCommand(manager, requestId)
    try {
      retiredWebsocket.dispatchEvent(acknowledgement)
      expect(Object.keys(manager.pendingCommands)).toEqual([requestId])
      expect(manager.responseMap[requestId]).toBeUndefined()

      websocket.dispatchEvent(acknowledgement)
      expect(Object.keys(manager.pendingCommands)).toEqual([])
      expect(await response).toBeInstanceOf(Uint8Array)
    } finally {
      manager.tearDown({ route: 'user-requested', initiatedBy: 'client' })
      await Promise.all([response, startup])
    }
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

  it('captures the camera only after execution drains and before closing', async () => {
    const { manager, close, requestReconnect } = reconnectHarness()
    let complete!: () => void
    const prepare = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          complete = () => resolve(undefined)
        })
    )
    manager['prepareForReconnect'] = prepare
    const finish = manager.trackExecution()
    requestReconnect()
    expect(prepare).not.toHaveBeenCalled()
    finish()
    requestReconnect()
    expect(prepare).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    complete()
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it('bounds an unresponsive camera capture and aborts it', async () => {
    vi.useFakeTimers()
    const { manager, close, requestReconnect } = reconnectHarness()
    let signal!: AbortSignal
    manager['prepareForReconnect'] = vi.fn((captureSignal) => {
      signal = captureSignal
      return new Promise<undefined>(() => {})
    })
    requestReconnect()
    await vi.advanceTimersByTimeAsync(299)
    expect(close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(signal.aborted).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not close a replacement connection when old camera capture completes', async () => {
    const { manager, close, requestReconnect } = reconnectHarness()
    let complete!: () => void
    manager['prepareForReconnect'] = () =>
      new Promise<undefined>((resolve) => {
        complete = () => resolve(undefined)
      })
    requestReconnect()
    addConnectedState(manager)
    const replacementClose = vi.fn()
    manager.connection!.closeForReconnect = replacementClose
    complete()
    await Promise.resolve()
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()
    expect(replacementClose).not.toHaveBeenCalled()
  })

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

  it.each(['replaced', 'retired'])(
    'does not resize a %s connection after waiting for readiness',
    async (transition) => {
      const manager = createConnectionManager()
      const connection = createTransport(manager)
      const replacement = createTransport(manager)
      const ready = promiseFactory<boolean>()
      connection.deferredConnection = ready
      manager.connection = connection
      const send = vi.spyOn(connection, 'send')
      const replacementSend = vi.spyOn(replacement, 'send')

      const resize = manager.handleResize({ width: 512, height: 512 })
      manager.connection = transition === 'replaced' ? replacement : undefined
      ready.resolve(true)

      await expect(resize).resolves.toBeUndefined()
      expect(manager.streamDimensions).toEqual({ width: 256, height: 256 })
      expect(send).not.toHaveBeenCalled()
      expect(replacementSend).not.toHaveBeenCalled()
    }
  )

  it.each(['same', 'replaced', 'retired'])(
    'waits for the resize acknowledgement and only updates the same connection (%s)',
    async (transition) => {
      const manager = createConnectionManager()
      const connection = createTransport(manager)
      manager.connection = connection
      const send = vi.spyOn(connection, 'send').mockImplementation(() => {})
      let completed = false
      const resize = manager
        .handleResize({ width: 512, height: 512 })
        .then(() => {
          completed = true
        })

      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
      const [request] = send.mock.calls[0]
      if (request.type !== 'modeling_cmd_req')
        expect.fail('Expected a resize modeling command')
      expect(request.cmd).toEqual({
        type: 'reconfigure_stream',
        width: 512,
        height: 512,
        fps: 60,
      })
      expect(completed).toBe(false)
      expect(manager.streamDimensions).toEqual({ width: 256, height: 256 })
      expect(manager.pendingCommands[request.cmd_id].isSceneCommand).toBe(true)
      if (transition !== 'same')
        manager.connection =
          transition === 'replaced' ? createTransport(manager) : undefined

      manager.createMessageHandler()(
        message({
          success: true,
          request_id: request.cmd_id,
          resp: {
            type: 'modeling',
            data: {
              modeling_response: { type: 'reconfigure_stream', data: {} },
            },
          },
        } satisfies WebSocketResponse)
      )
      await resize
      expect(completed).toBe(true)
      expect(manager.pendingCommands).toEqual({})
      expect(manager.streamDimensions).toEqual(
        transition === 'same'
          ? { width: 512, height: 512 }
          : { width: 256, height: 256 }
      )
      if (transition === 'same') {
        // A confirmed size must not restart the encoder a second time.
        await manager.handleResize({ width: 512, height: 512 })
        expect(send).toHaveBeenCalledOnce()
      }
    }
  )

  it('rejects a failed resize acknowledgement without changing confirmed dimensions', async () => {
    const manager = createConnectionManager()
    const connection = createTransport(manager)
    manager.connection = connection
    const send = vi.spyOn(connection, 'send').mockImplementation(() => {})
    const resize = manager.handleResize({ width: 512, height: 512 })
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const [request] = send.mock.calls[0]
    if (request.type !== 'modeling_cmd_req')
      expect.fail('Expected a resize modeling command')
    const failure = {
      success: false,
      request_id: request.cmd_id,
      errors: [{ error_code: 'internal_api', message: 'Resize rejected' }],
    } satisfies WebSocketResponse
    const rejected = expect(resize).rejects.toEqual([failure])
    manager.createMessageHandler()(message(failure))
    await rejected
    expect(manager.pendingCommands).toEqual({})
    expect(manager.streamDimensions).toEqual({ width: 256, height: 256 })
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
