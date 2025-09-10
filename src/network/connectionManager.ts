import type { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'
import { Connection } from '@src/network/connection'
import {
  darkModeMatcher,
  getOppositeTheme,
  getThemeColorForEngine,
  Themes,
} from '@src/lib/theme'
import { withWebSocketURL } from '@src/lib/withBaseURL'
import type {
  IEventListenerTracked,
  ModelTypes,
  PendingMessage,
  Subscription,
  UnreliableResponses,
  UnreliableSubscription,
} from '@src/network/utils'
import {
  ConnectingType,
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  EngineConnectionStateType,
  promiseFactory,
} from '@src/network/utils'
import {
  createOnDarkThemeMediaQueryChange,
  createOnEngineConnectionClosed,
  createOnEngineConnectionOpened,
  createOnEngineConnectionRestartRequest,
  createOnEngineConnectionStarted,
  createOnEngineOffline,
} from '@src/network/connectionManagerEvents'
import type RustContext from '@src/lib/rustContext'
import { binaryToUuid, isArray, uuidv4 } from '@src/lib/utils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type CodeManager from '@src/lang/codeManager'
import { BSON } from 'bson'
import { EngineDebugger } from '@src/lib/debugger'
import type { EngineCommand, ResponseMap } from '@src/lang/std/artifactGraph'
import type { CommandLog } from '@src/lang/std/commandLog'
import { CommandLogType } from '@src/lang/std/commandLog'
import { defaultSourceRange } from '@src/lang/sourceRange'
import type { SourceRange } from '@src/lang/wasm'
import type { KclManager } from '@src/lang/KclSingleton'
import { EXECUTE_AST_INTERRUPT_ERROR_MESSAGE } from '@src/lib/constants'
import type { useModelingContext } from '@src/hooks/useModelingContext'
import { reportRejection } from '@src/lib/trap'
import type { WebSocketRequest, WebSocketResponse } from '@kittycad/lib'
import {
  isExportResponse,
  isModelingBatchResponse,
  isModelingResponse,
} from '@src/lib/kcSdkGuards'

export class ConnectionManager extends EventTarget {
  started: boolean
  inSequence = 1
  _camControlsCameraChange = () => {}
  id: string

  /**
   * The pendingCommands object is a map of the commands that have been sent to the engine that are still waiting on a reply
   */
  pendingCommands: {
    [commandId: string]: PendingMessage
  } = {}

  /**
   * A map of the responses to the WASM, this response map allow
   * us to look up the response by command id
   */
  responseMap: ResponseMap = {}
  /**
   * A counter that is incremented with each command sent over the *unreliable* channel to the engine.
   * This is compared to the latest received {@link inSequence} number to determine if we should ignore
   * any out-of-order late responses in the unreliable channel.
   */
  outSequence = 1
  commandLogs: CommandLog[] = []

  connection: Connection | undefined
  sceneInfra: SceneInfra | undefined
  codeManager: CodeManager | undefined
  kclManager: KclManager | undefined

  // Circular dependency that is why it can be undefined
  rustContext: RustContext | undefined

  streamDimensions = {
    // startFromWasm uses 256, 256
    width: 256,
    height: 256,
  }
  settings: SettingsViaQueryString = {
    pool: null,
    theme: Themes.Dark,
    highlightEdges: true,
    enableSSAO: true,
    showScaleGrid: false,
    cameraProjection: 'orthographic', // Gotcha: was perspective now is orthographic
    cameraOrbit: 'spherical',
  }

  subscriptions: {
    [event: string]: {
      [localUnsubscribeId: string]: (a: any) => void
    }
  } = {} as any
  unreliableSubscriptions: {
    [event: string]: {
      [localUnsubscribeId: string]: (a: any) => void
    }
  } = {} as any
  _commandLogCallBack: (command: CommandLog[]) => void = () => {}
  // Rogue runtime dependency from the modeling machine. hope it is there!
  modelingSend: ReturnType<typeof useModelingContext>['send'] =
    (() => {}) as any
  // Any event listener into this map to be cleaned up later
  // helps avoids duplicates as well
  allEventListeners: Map<string, IEventListenerTracked>

  callbackOnUnitTestingConnection: (() => void) | null

  constructor(settings?: SettingsViaQueryString) {
    super()
    this.started = false
    this.allEventListeners = new Map()
    this.id = uuidv4()
    this.callbackOnUnitTestingConnection = null

    if (settings) {
      // completely overwrite the settings
      this.settings = settings
    }
  }

  setInSequence(sequence: number) {
    this.inSequence = sequence
  }

  set camControlsCameraChange(cb: () => void) {
    this._camControlsCameraChange = cb
  }

  // I guess this in the entry point
  // Don't initialize a different set of default settings, what is the point!
  async start({
    settings,
    width,
    height,
    token,
    setStreamIsReady,
    callbackOnUnitTestingConnection,
  }: {
    settings?: SettingsViaQueryString
    width: number
    height: number
    token: string
    setStreamIsReady: (setStreamIsReady: boolean) => void
    callbackOnUnitTestingConnection?: () => void
  }) {
    EngineDebugger.addLog({
      label: 'connectionManager',
      message: 'start',
    })
    if (this.started) {
      return Promise.reject(
        new Error(
          'You tried to start the engine again, why are you starting it? call tearDown first.'
        )
      )
    }
    this.started = true
    this.rejectAllPendingCommands()

    if (this.connection) {
      return Promise.reject(
        new Error('You tried to make a new connection. You already have one!')
      )
    }

    if (width <= 0) {
      return Promise.reject(new Error(`width is <=0, ${width}`))
    }

    if (height <= 0) {
      return Promise.reject(new Error(`height is <=0, ${height}`))
    }

    // Make sure dependencies exist during runtime otherwise crash!
    if (!this.rustContext) {
      return Promise.reject(new Error('rustContext is undefined'))
    }
    1
    if (!this.sceneInfra) {
      return Promise.reject(new Error('sceneInfra is undefined'))
    }

    if (settings) {
      this.settings = settings
    }

    this.streamDimensions = {
      width,
      height,
    }

    const url = this.generateWebsocketURL()
    this.connection = new Connection({
      url,
      token,
      handleOnDataChannelMessage: this.handleOnDataChannelMessage.bind(this),
      tearDownManager: this.tearDown.bind(this),
      rejectPendingCommand: this.rejectPendingCommand.bind(this),
      callbackOnUnitTestingConnection,
      handleMessage: this.handleMessage.bind(this),
    })

    // Nothing more to do when using a lite engine initialization
    if (callbackOnUnitTestingConnection) {
      this.callbackOnUnitTestingConnection = callbackOnUnitTestingConnection
      return
    }

    // Only used for useNetworkStatus.tsx listeners, why?!
    this.dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.EngineAvailable, {
        detail: this.connection,
      })
    )
    // Gotcha: ^this is a race condition with EngineAvailable but that is life.
    // TODO: this is called in createWebSocketConnection
    this.connection.dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.WebSocketConnecting,
          },
        },
      })
    )

    await this.connection.connect()

    // Moved from ondatachannelopen in RTCPeerConnection.
    this.inSequence = 1

    if (!this.connection.peerConnection) {
      return Promise.reject(
        new Error('this.connection.peerConnection is undefined')
      )
    }
    if (!this.connection.websocket) {
      return Promise.reject(new Error('this.connection.websocket is undefined'))
    }

    const onEngineConnectionRestartRequest =
      createOnEngineConnectionRestartRequest({
        dispatchEvent: this.dispatchEvent.bind(this),
      })
    const onEngineOffline = createOnEngineOffline({
      dispatchEvent: this.dispatchEvent.bind(this),
    })

    const onEngineConnectionClosed = createOnEngineConnectionClosed()
    const onEngineConnectionStarted = createOnEngineConnectionStarted({
      peerConnection: this.connection.peerConnection,
      getUnreliableSubscriptions: () => {
        return this.unreliableSubscriptions
      },
      setInSequence: this.setInSequence.bind(this),
      getInSequence: () => {
        return this.inSequence
      },
      websocket: this.connection.websocket,
      handleMessage: this.handleMessage.bind(this),
      connection: this.connection,
      trackListener: this.trackListener.bind(this),
    })

    this.trackListener(EngineConnectionEvents.RestartRequest, {
      event: EngineConnectionEvents.RestartRequest,
      callback: onEngineConnectionRestartRequest,
      type: 'connection',
    })
    this.connection.addEventListener(
      EngineConnectionEvents.RestartRequest,
      onEngineConnectionRestartRequest
    )

    this.trackListener(EngineConnectionEvents.Offline, {
      event: EngineConnectionEvents.Offline,
      callback: onEngineOffline,
      type: 'connection',
    })
    this.connection.addEventListener(
      EngineConnectionEvents.Offline,
      onEngineOffline
    )

    this.trackListener(EngineConnectionEvents.Closed, {
      event: EngineConnectionEvents.Closed,
      callback: onEngineConnectionClosed,
      type: 'connection',
    })
    this.connection.addEventListener(
      EngineConnectionEvents.Closed,
      onEngineConnectionClosed
    )

    this.trackListener(EngineConnectionEvents.ConnectionStarted, {
      event: EngineConnectionEvents.ConnectionStarted,
      callback: onEngineConnectionStarted,
      type: 'connection',
    })
    this.connection.addEventListener(
      EngineConnectionEvents.ConnectionStarted,
      onEngineConnectionStarted
    )

    this.connection.dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStarted, {
        // detail: this,
      })
    )

    const onEngineConnectionOpened = createOnEngineConnectionOpened({
      rustContext: this.rustContext,
      settings: this.settings,
      jsAppSettings: await jsAppSettings(),
      path: this.codeManager?.currentFilePath || '',
      sendSceneCommand: this.sendSceneCommand.bind(this),
      setTheme: this.setTheme.bind(this),
      listenToDarkModeMatcher: this.listenToDarkModeMatcher.bind(this),
      // Don't think this needs the bind because it is an external set function for the callback
      camControlsCameraChange: this._camControlsCameraChange,
      sceneInfra: this.sceneInfra,
      connection: this.connection,
      setStreamIsReady,
    })

    // Engine is ready to start sending events!
    // Gotcha: The other listenerse above need to be initialized otherwise this will halt forever.
    await onEngineConnectionOpened()
  }

  /**
   * Pass a callback function down to a connection instance for the peerConnection 'message' event
   */
  handleOnDataChannelMessage(event: MessageEvent<any>) {
    const result: UnreliableResponses = JSON.parse(event.data)
    Object.values(this.unreliableSubscriptions[result.type] || {}).forEach(
      // TODO: There is only one response that uses the unreliable channel atm,
      // highlight_set_entity, if there are more it's likely they will all have the same
      // sequence logic, but I'm not sure if we use a single global sequence or a sequence
      // per unreliable subscription.
      (callback) => {
        if (
          result.type === 'highlight_set_entity' &&
          result?.data?.sequence &&
          result?.data.sequence > this.inSequence
        ) {
          this.inSequence = result.data.sequence
          callback(result)
        } else if (result.type !== 'highlight_set_entity') {
          callback(result)
        }
      }
    )
  }

  generateWebsocketURL() {
    let additionalSettings = this.settings.enableSSAO ? '&post_effect=ssao' : ''
    additionalSettings +=
      '&show_grid=' + (this.settings.showScaleGrid ? 'true' : 'false')
    const pool = !this.settings.pool ? '' : `&pool=${this.settings.pool}`
    const url = withWebSocketURL(
      `?video_res_width=${this.streamDimensions.width}&video_res_height=${this.streamDimensions.height}${additionalSettings}${pool}`
    )
    return url
  }

  // Set the engine's theme
  async setTheme(theme: Themes) {
    // Set the stream background color
    // This takes RGBA values from 0-1
    // So we convert from the conventional 0-255 found in Figma
    await this.sendSceneCommand({
      cmd_id: uuidv4(),
      type: 'modeling_cmd_req',
      cmd: {
        type: 'set_background_color',
        color: getThemeColorForEngine(theme),
      },
    })

    // Sets the default line colors
    const opposingTheme = getOppositeTheme(theme)
    await this.sendSceneCommand({
      cmd_id: uuidv4(),
      type: 'modeling_cmd_req',
      cmd: {
        type: 'set_default_system_properties',
        color: getThemeColorForEngine(opposingTheme),
      },
    })
  }

  listenToDarkModeMatcher() {
    // TODO: Keep track of event listener
    const onDarkThemeMediaQueryChange = createOnDarkThemeMediaQueryChange({
      setTheme: this.setTheme.bind(this),
    })
    this.trackListener('darkmodewatcher-change', {
      event: 'change',
      callback: onDarkThemeMediaQueryChange,
      type: 'darkModeMatcher',
    })
    darkModeMatcher?.addEventListener('change', onDarkThemeMediaQueryChange)
  }

  async sendSceneCommand(
    command: EngineCommand,
    forceWebsocket = false
  ): Promise<WebSocketResponse | [WebSocketResponse] | null> {
    if (this.connection === undefined) {
      EngineDebugger.addLog({
        label: 'sendSceneCommand',
        message: 'connection is undefined, you are too early',
        metadata: {
          command,
        },
      })
      return Promise.resolve(null)
    }

    // TODO: connection.isReady()? No.

    if (
      !(
        command.type === 'modeling_cmd_req' &&
        (command.cmd.type === 'highlight_set_entity' ||
          command.cmd.type === 'mouse_move' ||
          command.cmd.type === 'camera_drag_move' ||
          command.cmd.type === ('default_camera_perspective_settings' as any))
      )
    ) {
      // highlight_set_entity, mouse_move and camera_drag_move are sent over the unreliable channel and are too noisy
      this.addCommandLog({
        type: CommandLogType.SendScene,
        data: command,
      })
    }

    if (command.type === 'modeling_cmd_batch_req') {
      this.connection.send(command)
      // TODO - handlePendingCommands does not handle batch commands
      // return this.handlePendingCommand(command.requests[0].cmd_id, command.cmd)
      return Promise.resolve(null)
    }

    if (command.type !== 'modeling_cmd_req') {
      return Promise.resolve(null)
    }

    const cmd = command.cmd
    if (
      (cmd.type === 'camera_drag_move' ||
        cmd.type === 'handle_mouse_drag_move' ||
        cmd.type === 'default_camera_zoom' ||
        cmd.type === ('default_camera_perspective_settings' as any)) &&
      this.connection.unreliableDataChannel &&
      !forceWebsocket
    ) {
      ;(cmd as any).sequence = this.outSequence
      this.outSequence++
      this.connection.unreliableSend(command)
      return Promise.resolve(null)
    } else if (
      cmd.type === 'highlight_set_entity' &&
      this.connection.unreliableDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.connection.unreliableSend(command)
      return Promise.resolve(null)
    } else if (
      cmd.type === 'mouse_move' &&
      this.connection.unreliableDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.connection.unreliableSend(command)
      return Promise.resolve(null)
    }
    if (
      command.cmd.type === 'default_camera_look_at' ||
      command.cmd.type === ('default_camera_perspective_settings' as any)
    ) {
      ;(cmd as any).sequence = this.outSequence++
    }
    // since it's not mouse drag or highlighting send over TCP and keep track of the command
    return this.sendCommand(
      command.cmd_id,
      {
        command,
        idToRangeMap: {},
        range: defaultSourceRange(),
      },
      true // isSceneCommand
    )
      .then(([a]) => a)
      .catch((e) => {
        // TODO: Previously was never caught, we are not rejecting these pendingCommands but this needs to be handled at some point.
        /*noop*/
        EngineDebugger.addLog({
          label: 'sendCommand',
          message: 'error',
          metadata: { error: e },
        })
        return e
      })
  }

  /**
   * Common send command function used for both modeling and scene commands
   * So that both have a common way to send pending commands with promises for the responses
   */
  async sendCommand(
    id: string,
    message: {
      command: PendingMessage['command']
      range: PendingMessage['range']
      idToRangeMap: PendingMessage['idToRangeMap']
    },
    isSceneCommand = false
  ): Promise<[WebSocketResponse]> {
    if (!this.connection) {
      return Promise.reject(
        new Error(
          `sendCommand - this.connection is undefined. id: ${id}, message:${message}, isSceneCommand:${isSceneCommand}`
        )
      )
    }

    const { promise, resolve, reject } = promiseFactory<any>()
    this.pendingCommands[id] = {
      resolve,
      reject,
      promise,
      command: message.command,
      range: message.range,
      idToRangeMap: message.idToRangeMap,
      isSceneCommand,
    }
    this.connection.send(message.command)
    return promise
  }

  // this.connection.websocket.addEventListener('message') handler
  handleMessage(event: MessageEvent) {
    if (!this.rustContext) {
      console.error('rustContext is undefined not processing event:', event)
      return
    }

    let message: WebSocketResponse | null = null

    if (event.data instanceof ArrayBuffer) {
      // BSON deserialize the command
      message = BSON.deserialize(
        new Uint8Array(event.data)
      ) as WebSocketResponse
      // The request id comes back as binary and we want to get the uuid
      // string from that.

      if (message.request_id) {
        message.request_id = binaryToUuid(message.request_id)
      }
    } else {
      message = JSON.parse(event.data)
    }

    if (message === null) {
      EngineDebugger.addLog({
        label: 'handleMessage',
        message: 'received a null message from the engine',
      })
      // We should never get here.
      console.error('Received a null message from the engine', event)
      return
    }

    if (message.request_id === undefined || message.request_id === null) {
      // We only care about messages that have a request id, so we can
      // ignore the rest.

      // Most likely ping/pong requests here
      return
    }

    this.rustContext.sendResponse(message).catch((error) => {
      console.error('Error sending response to rust', error)
      EngineDebugger.addLog({
        label: 'rustContext.sendResponse',
        message: 'error sending response to rust',
        metadata: {
          error,
        },
      })
    })

    const pending = this.pendingCommands[message.request_id || '']
    if (pending && !message.success) {
      pending.reject([message])
      delete this.pendingCommands[message.request_id || '']
    }

    if (
      !(
        pending &&
        message.success &&
        (isModelingResponse(message) ||
          isModelingBatchResponse(message) ||
          isExportResponse(message))
      )
    ) {
      if (pending) {
        pending.reject([message])
        delete this.pendingCommands[message.request_id || '']
      }
      return
    }

    pending.resolve([message])
    delete this.pendingCommands[message.request_id || '']

    if (message.resp.type === 'export' && message.request_id) {
      this.responseMap[message.request_id] = message.resp
    } else if (
      message.resp.type === 'modeling' &&
      pending.command.type === 'modeling_cmd_req' &&
      message.request_id
    ) {
      this.addCommandLog({
        type: CommandLogType.ReceiveReliable,
        data: message.resp,
        id: message?.request_id || '',
        cmd_type: pending?.command?.cmd?.type,
      })

      const modelingResponse = message.resp.data.modeling_response

      Object.values(this.subscriptions[modelingResponse.type] || {}).forEach(
        (callback) => callback(modelingResponse)
      )

      this.responseMap[message.request_id] = message.resp
    } else if (
      message.resp.type === 'modeling_batch' &&
      pending.command.type === 'modeling_cmd_batch_req'
    ) {
      let individualPendingResponses: {
        [key: string]: WebSocketRequest
      } = {}
      pending.command.requests.forEach(({ cmd, cmd_id }) => {
        individualPendingResponses[cmd_id] = {
          type: 'modeling_cmd_req',
          cmd,
          cmd_id,
        }
      })
      Object.entries(message.resp.data.responses).forEach(
        ([commandId, response]) => {
          if (!('response' in response)) return
          const command = individualPendingResponses[commandId]
          if (!command) return
          if (command.type === 'modeling_cmd_req')
            this.addCommandLog({
              type: CommandLogType.ReceiveReliable,
              data: {
                type: 'modeling',
                data: {
                  modeling_response: response.response,
                },
              },
              id: commandId,
              cmd_type: command?.cmd?.type,
            })

          this.responseMap[commandId] = {
            type: 'modeling',
            data: {
              modeling_response: response.response,
            },
          }
        }
      )
    }
  }

  subscribeTo<T extends ModelTypes>({
    event,
    callback,
  }: Subscription<T>): () => void {
    const localUnsubscribeId = uuidv4()
    if (!this.subscriptions[event]) {
      this.subscriptions[event] = {}
    }
    this.subscriptions[event][localUnsubscribeId] = callback

    return () => this.unSubscribeTo(event, localUnsubscribeId)
  }
  private unSubscribeTo(event: ModelTypes, id: string) {
    delete this.subscriptions[event][id]
  }

  subscribeToUnreliable<T extends UnreliableResponses['type']>({
    event,
    callback,
  }: UnreliableSubscription<T>): () => void {
    const localUnsubscribeId = uuidv4()
    if (!this.unreliableSubscriptions[event]) {
      this.unreliableSubscriptions[event] = {}
    }
    this.unreliableSubscriptions[event][localUnsubscribeId] = callback
    return () => this.unSubscribeToUnreliable(event, localUnsubscribeId)
  }

  private unSubscribeToUnreliable(
    event: UnreliableResponses['type'],
    id: string
  ) {
    delete this.unreliableSubscriptions[event][id]
  }

  // TODO: What workflow triggers this?
  async startFromWasm(token: string): Promise<void> {
    EngineDebugger.addLog({
      label: 'connectionManager',
      message: 'startFromWasm',
    })
    return await this.start({
      token,
      width: 256,
      height: 256,
      setStreamIsReady: () => {
        console.error('This is a NO OP. Should not be called in web.')
      },
      callbackOnUnitTestingConnection: () => {
        console.log('what is happening, why is rust doing this!')
      },
    })
  }

  addCommandLog(message: CommandLog) {
    if (this.commandLogs.length > 500) {
      this.commandLogs.shift()
    }
    this.commandLogs.push(message)

    this._commandLogCallBack([...this.commandLogs])
  }

  clearCommandLogs() {
    this.commandLogs = []
    this._commandLogCallBack(this.commandLogs)
  }

  registerCommandLogCallback(callback: (command: CommandLog[]) => void) {
    this._commandLogCallBack = callback
  }

  async handleResize({ width, height }: { width: number; height: number }) {
    if (!this.connection) {
      console.warn('unable to resize, connection is not found')
      return
    }

    // Make sure the connection is ready otherwise you are sending the events too early.
    await this.connection.deferredConnection?.promise

    this.streamDimensions = {
      width,
      height,
    }

    const resizeCmd: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'reconfigure_stream',
        ...this.streamDimensions,
        fps: 60, // This is required but it does next to nothing
      },
    }
    this.connection.send(resizeCmd)
  }

  tearDown() {
    if (!this.started) {
      EngineDebugger.addLog({
        label: 'connectionManager',
        message:
          'you called tearDown without ever calling start(), exiting early.',
      })
    }

    if (!this.connection) {
      EngineDebugger.addLog({
        label: 'connectionManager',
        message: 'unable to tear down this.connection, connection is missing',
      })
    }

    if (this.connection) {
      this.connection.deferredConnection?.reject(
        'tearingDown connectionManager'
      )
      this.connection.deferredMediaStreamAndWebrtcStatsCollector?.reject(
        'tearingDown connectionManager'
      )
      this.connection.deferredPeerConnection?.reject(
        'tearingDown connectionManager'
      )
      this.connection.deferredSdpAnswer?.reject('tearingDown connectionManager')
    }
    this.rejectAllPendingCommands()
    // Make sure to get all the deeply nested ones as well.
    this.removeAllEventListeners()
    this.connection?.disconnectAll()
    this.connection = undefined

    // It is possible all connections never even started, but we still want
    // to signal to the whole application we are "offline".
    this.dispatchEvent(new CustomEvent(EngineCommandManagerEvents.Offline, {}))

    // Allow for restart!
    this.started = false
  }

  rejectPendingCommand({
    cmdId,
  }: {
    cmdId: string
  }) {
    if (this.pendingCommands[cmdId]) {
      const pendingCommand = this.pendingCommands[cmdId]
      pendingCommand.reject([
        {
          success: false,
          errors: [
            {
              error_code: 'connection_problem',
              // TODO: Kevin
              message: `ODDLY SPECIFIC REJECTION!`,
            },
          ],
        },
      ])
      delete this.pendingCommands[cmdId]
    }
  }

  rejectAllPendingCommands() {
    EngineDebugger.addLog({
      label: 'connectionManager',
      message: 'rejectAllPendingCommands',
    })
    for (const [cmdId, pending] of Object.entries(this.pendingCommands)) {
      pending.reject([
        {
          success: false,
          errors: [
            {
              error_code: 'connection_problem',
              message: `no connection to send on, connection manager called tearDown(). cmdId: ${cmdId}`,
            },
          ],
        },
      ])
      delete this.pendingCommands[cmdId]
    }
  }

  offline() {
    // TODO: keepForcefulOffline
    this.tearDown()
    EngineDebugger.addLog({
      label: 'connectionManager',
      message: 'offline',
    })
  }

  online() {
    // TODO: keepForcefulOffline
    this.dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.EngineRestartRequest, {})
    )
    EngineDebugger.addLog({
      label: 'connectionManager',
      message: 'online - EngineRestartRequest',
    })
  }

  // Only bound on the WASM side, no JS calls.
  async startNewSession() {
    this.responseMap = {}
    EngineDebugger.addLog({
      label: 'connectionManager',
      message: 'startNewSession - responseMap = {}',
    })
  }

  // This is only metadata overhead to keep track of all the event listeners which allows for easy
  // removal during cleanUp. It can help prevent multiple runtime initializations of events.
  trackListener(name: string, eventListenerTracked: IEventListenerTracked) {
    if (this.allEventListeners.has(name)) {
      console.error(
        `You are trying to track something twice, good luck! you're crashing. ${name}`
      )
      return
    }

    this.allEventListeners.set(name, eventListenerTracked)
  }

  removeAllEventListeners() {
    // Could hard code all the possible event keys and see if each one is removed.
    const listenersToRemove = Array.from(this.allEventListeners)

    listenersToRemove.forEach(
      ([event, eventListenerTracked]: [string, IEventListenerTracked]) => {
        const type = eventListenerTracked.type

        if (type === 'connection') {
          if (!this.connection) {
            EngineDebugger.addLog({
              label: 'connectionManager',
              message:
                'removeAllEventListeners - connection event listener unable to be removed.',
            })
          }
          this.connection?.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else if (type === 'darkModeMatcher') {
          if (!darkModeMatcher) {
            EngineDebugger.addLog({
              label: 'connectionManager',
              message:
                'removeAllEventListeners - darkModeMatcher event listener unable to be removed.',
            })
          }
          darkModeMatcher?.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else if (type === 'peerConnection') {
          if (!this.connection?.peerConnection) {
            EngineDebugger.addLog({
              label: 'connectionManager',
              message:
                'removeAllEventListeners - peerConnection event listener unable to be removed.',
            })
          }
          this.connection?.peerConnection?.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else if (type === 'websocket') {
          if (!this.connection?.websocket) {
            EngineDebugger.addLog({
              label: 'connectionManager',
              message:
                'removeAllEventListeners - websocket event listener unable to be removed.',
            })
          }
          this.connection?.websocket?.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else {
          console.error(`untracked listener type ${type}`)
        }
      }
    )

    // Remove all references to the event listeners they are already removed.
    this.allEventListeners = new Map()
    EngineDebugger.addLog({
      label: 'connectionManager',
      message: 'removeAllEventListeners',
      metadata: { id: this.id },
    })
  }

  /**
   * A wrapper around the sendCommand where all inputs are JSON strings
   *
   * This one does not wait for a response.
   */
  fireModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): void | Error {
    if (this.connection === undefined) {
      return new Error('this.connection is undefined')
    }
    //TODO isReady() isUsingConnectionLite
    if (id === undefined) {
      return new Error('id is undefined')
    }
    if (rangeStr === undefined) {
      return new Error('rangeStr is undefined')
    }
    if (commandStr === undefined) {
      return new Error('commandStr is undefined')
    }
    if (!this.kclManager) {
      return new Error('this.kclManager is undefined')
    }

    const range: SourceRange = JSON.parse(rangeStr)
    const command: EngineCommand = JSON.parse(commandStr)
    const idToRangeMap: { [key: string]: SourceRange } =
      JSON.parse(idToRangeStr)

    // Current executeAst is stale, going to interrupt, a new executeAst will trigger
    // Used in conjunction with rejectAllModelingCommands
    if (this.kclManager.executeIsStale) {
      return new Error(EXECUTE_AST_INTERRUPT_ERROR_MESSAGE)
    }

    // We purposely don't wait for a response here
    this.sendCommand(id, {
      command,
      range,
      idToRangeMap,
    }).catch(reportRejection)
  }

  /**
   * A wrapper around the sendCommand where all inputs are JSON strings
   */
  async sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<Uint8Array | void> {
    if (this.connection === undefined) {
      return Promise.reject(new Error('this.connection is undefined'))
    }
    if (!this.kclManager) {
      return Promise.reject(new Error('this.kclManager is undefined'))
    }
    //TODO isReady() isUsingConnectionLite
    if (id === undefined) {
      return Promise.reject(new Error('id is undefined'))
    }
    if (rangeStr === undefined) {
      return Promise.reject(new Error('rangeStr is undefined'))
    }
    if (commandStr === undefined) {
      return Promise.reject(new Error('commandStr is undefined'))
    }

    const range: SourceRange = JSON.parse(rangeStr)
    const command: EngineCommand = JSON.parse(commandStr)
    const idToRangeMap: { [key: string]: SourceRange } =
      JSON.parse(idToRangeStr)
    // Current executeAst is stale, going to interrupt, a new executeAst will trigger
    // Used in conjunction with rejectAllModelingCommands
    if (this.kclManager.executeIsStale) {
      return Promise.reject(EXECUTE_AST_INTERRUPT_ERROR_MESSAGE)
    }
    try {
      const resp = await this.sendCommand(id, {
        command,
        range,
        idToRangeMap,
      })
      return BSON.serialize(resp[0])
    } catch (e) {
      console.error(e)
      if (isArray(e) && e.length > 0) {
        EngineDebugger.addLog({
          label: 'sendCommand',
          message: 'error',
          metadata: { e: JSON.stringify(e[0]) },
        })
        return Promise.reject(JSON.stringify(e[0]))
      }

      EngineDebugger.addLog({
        label: 'sendCommand',
        message: 'error',
        metadata: { e: JSON.stringify(e) },
      })
      return Promise.reject(JSON.stringify(e))
    }
  }

  /**
   * When an execution takes place we want to wait until we've got replies for all of the commands
   * When this is done when we build the artifact map synchronously.
   */
  waitForAllCommands() {
    return Promise.all(
      Object.values(this.pendingCommands).map((a) => a.promise)
    )
  }

  /**
   * Reject all of the modeling pendingCommands created from sendModelingCommandFromWasm
   * This interrupts the runtime of executeAst. Stops the AST processing and stops sending commands
   * to the engine
   */
  rejectAllModelingCommands(rejectionMessage: string) {
    for (const [cmdId, pending] of Object.entries(this.pendingCommands)) {
      if (!pending.isSceneCommand) {
        pending.reject([
          {
            success: false,
            errors: [{ error_code: 'internal_api', message: rejectionMessage }],
          },
        ])
        delete this.pendingCommands[cmdId]
      }
    }
  }

  async setPlaneHidden(id: string, hidden: boolean) {
    if (this.connection === undefined) {
      console.error('setPlaneHidden - this.connection is undefined')
      EngineDebugger.addLog({
        label: 'setPlaneHidden',
        message:
          'connectionManager, you are too early to set the planes hidden.',
      })
      return
    }

    // TODO: Can't send commands if there's no connection
    return await this.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'object_visible',
        object_id: id,
        hidden: hidden,
      },
    })
  }
}
