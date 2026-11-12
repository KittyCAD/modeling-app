const reportClientError = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return { ...actual, reportClientError }
})

import type { ModelingCmdReq } from '@kittycad/lib'
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
import { Themes } from '@src/lib/theme'
import { createSettings } from '@src/lib/settings/initialSettings'
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

function createConnectionManager(settings = createSettings()) {
  return new ConnectionManager({
    settingsActor: {
      getSnapshot: () => ({ context: settings }),
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
  it('identifies actual connection replacement without treating scene resets as a new session', async () => {
    const manager = createConnectionManager()
    const createTransport = () =>
      new Connection({
        url: 'ws://localhost/modeling-session-identity',
        token: 'test-token',
        handleOnDataChannelMessage: vi.fn(),
        recordShutdownTrigger: manager.recordShutdownTrigger.bind(manager),
        tearDownManager: manager.tearDown.bind(manager),
        rejectPendingCommand: vi.fn(),
        handleMessage: vi.fn(),
        getCloudProjectId: () => undefined,
      })

    expect(manager.engineSessionId).toBeUndefined()
    const first = createTransport()
    manager.connection = first
    expect(manager.engineSessionId).toBe(first.id)

    await manager.startNewSession()
    expect(manager.engineSessionId).toBe(first.id)

    const replacement = createTransport()
    manager.connection = replacement
    expect(manager.engineSessionId).toBe(replacement.id)
    expect(manager.engineSessionId).not.toBe(first.id)

    manager.connection = undefined
    expect(manager.engineSessionId).toBeUndefined()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    reportClientError.mockClear()
    ReconnectTestWebSocket.instances = []
  })

  it('only requests a rendering reconnect when the connected mode differs', () => {
    const manager = createConnectionManager()
    const requestReconnect = vi.fn()
    const connection = new Connection({
      url: 'wss://example.test/modeling?post_effect=ssao',
      token: 'test-token',
      handleOnDataChannelMessage: vi.fn(),
      recordShutdownTrigger: vi.fn(() => true),
      tearDownManager: vi.fn(),
      rejectPendingCommand: vi.fn(),
      handleMessage: vi.fn(),
      getCloudProjectId: () => undefined,
    })
    vi.spyOn(connection, 'requestReconnect').mockImplementation(
      requestReconnect
    )
    manager.connection = connection
    manager.setViewportRendering('ssao')
    expect(requestReconnect).not.toHaveBeenCalled()
    manager.setViewportRendering('retrocad')
    expect(requestReconnect).toHaveBeenCalledOnce()
  })

  it.each([true, false])(
    'does not reconnect a local session with the local preference set to %s',
    (useLocalRenderer) => {
      const settings = createSettings()
      settings.modeling.useLocalRenderer.user = useLocalRenderer
      const manager = createConnectionManager(settings)
      const requestReconnect = vi.fn()
      manager.connection = {
        geometryOnly: true,
        url: 'wss://example.test/modeling?geometry_only=true&webrtc=false',
        requestReconnect,
      } as unknown as Connection

      for (const mode of [
        'ssao',
        'retrocad',
        'phosphor',
        'noeffect',
      ] as const) {
        manager.setViewportRendering(mode)
      }
      expect(requestReconnect).not.toHaveBeenCalled()
    }
  )

  it('does not start a disconnected local session when the stream style changes', () => {
    const settings = createSettings()
    settings.modeling.useLocalRenderer.user = true
    const manager = createConnectionManager(settings)
    const online = vi.spyOn(manager, 'online')

    manager.setViewportRendering('retrocad')
    expect(online).not.toHaveBeenCalled()
  })

  it('keeps using stream settings until the renderer restart happens', () => {
    const settings = createSettings()
    settings.modeling.useLocalRenderer.user = true
    const manager = createConnectionManager(settings)
    const requestReconnect = vi.fn()
    manager.connection = {
      geometryOnly: false,
      url: 'wss://example.test/modeling?post_effect=ssao',
      requestReconnect,
    } as unknown as Connection

    manager.setViewportRendering('retrocad')
    expect(requestReconnect).toHaveBeenCalledOnce()
  })

  it('uses geometry-only URL parameters without engine render settings', () => {
    const manager = createConnectionManager()
    vi.spyOn(manager, 'settings', 'get').mockReturnValue({
      theme: Themes.Light,
      viewportRendering: 'ssao',
      showScaleGrid: true,
      highlightEdges: true,
      cameraProjection: 'perspective',
      cameraOrbit: 'spherical',
      backfaceColor: '#ffffff',
    })

    // The same manager can construct either kind of session after a mode change.
    for (const geometryOnly of [true, false, true]) {
      const url = new URL(manager.generateWebsocketURL(geometryOnly, '2.0'))
      expect(url.searchParams.get('webrtc')).toBe(geometryOnly ? 'false' : null)
      expect(url.searchParams.get('kcl_version')).toBe('2.0')
      expect(url.searchParams.get('geometry_only')).toBe(
        geometryOnly ? 'true' : null
      )
      expect(url.searchParams.has('post_effect')).toBe(!geometryOnly)
      expect(url.searchParams.has('show_grid')).toBe(!geometryOnly)
      expect(url.searchParams.has('video_res_width')).toBe(true)
    }
    expect(manager.settings.viewportRendering).toBe('ssao')
  })

  it.each(['default', 'retrocad', 'phosphor'] as const)(
    'uses shared SSAO only for the default cloud style: %s',
    (style) => {
      const settings = createSettings()
      settings.modeling.viewportRendering.user = style
      const manager = createConnectionManager(settings)
      for (const enableSSAO of [true, false]) {
        settings.modeling.enableSSAO.user = enableSSAO
        const url = new URL(manager.generateWebsocketURL())
        expect(url.searchParams.get('post_effect')).toBe(
          style === 'default' ? (enableSSAO ? 'ssao' : 'noeffect') : style
        )
      }
    }
  )

  it('skips rendering updates only for the current geometry-only connection', async () => {
    const manager = createConnectionManager()
    const send = vi.fn()
    const sendSceneCommand = vi
      .spyOn(manager, 'sendSceneCommand')
      .mockResolvedValue(null)

    for (const geometryOnly of [true, false, true]) {
      addConnectedState(manager)
      manager.connection = {
        ...manager.connection,
        geometryOnly,
        deferredConnection: { promise: Promise.resolve() },
        send,
      } as unknown as Connection
      sendSceneCommand.mockClear()
      send.mockClear()

      expect(manager.geometryOnly).toBe(geometryOnly)
      await manager.setTheme(Themes.Light)
      await manager.setDefaultSystemProperties('#ffffff')
      await manager.setHighlightEdges(true)
      await manager.setShowScaleGrid(true)
      await manager.handleResize({ width: 512, height: 512 })

      expect(sendSceneCommand).toHaveBeenCalledTimes(geometryOnly ? 0 : 5)
      expect(send).toHaveBeenCalledTimes(geometryOnly ? 0 : 1)
    }
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

  it.each([
    { type: 'begin_execution', enable_render: true },
    { type: 'end_execution' },
  ] satisfies ModelingCmdReq['cmd'][])(
    'allows $type after interruption while blocking modeling work',
    async (boundary) => {
      const manager = createConnectionManager()
      addConnectedState(manager)
      manager.executionIsStale = true
      const sendCommand = vi.spyOn(manager, 'sendCommand').mockResolvedValue([
        {
          success: true,
          request_id: 'boundary',
          resp: {
            type: 'modeling',
            data: { modeling_response: { type: boundary.type, data: {} } },
          },
        },
      ])
      const sendModeling = (id: string, cmd: ModelingCmdReq['cmd']) =>
        manager.sendModelingCommandFromWasm(
          id,
          '[0,0,0]',
          JSON.stringify({ type: 'modeling_cmd_req', cmd_id: id, cmd }),
          '{}'
        )

      await expect(
        sendModeling('stale', { type: 'scene_clear_all' })
      ).rejects.toBe(EXECUTE_AST_INTERRUPT_ERROR_MESSAGE)
      expect(sendCommand).not.toHaveBeenCalled()

      await expect(sendModeling('boundary', boundary)).resolves.toBeInstanceOf(
        Uint8Array
      )
      expect(sendCommand).toHaveBeenCalledExactlyOnceWith('boundary', {
        command: {
          type: 'modeling_cmd_req',
          cmd_id: 'boundary',
          cmd: boundary,
        },
        range: [0, 0, 0],
        idToRangeMap: {},
      })
    }
  )

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

  it.each([
    { code: 1000, source: 'api' },
    { code: 1006, source: 'api' },
    { code: 1000, source: 'client' },
  ] as const)(
    'carries a $source reconnect through socket closure $code and manager cleanup',
    ({ code, source }) => {
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
      if (source === 'api') {
        socket.dispatchEvent(new MessageEvent('message', { data: notice }))
        socket.dispatchEvent(new MessageEvent('message', { data: notice }))
      } else {
        connection.requestReconnect()
        connection.requestReconnect()
      }
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
            initiatedBy: source,
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
