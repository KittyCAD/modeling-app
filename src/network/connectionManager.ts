import { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'
import { Connection } from './connection'
import {
  darkModeMatcher,
  getOppositeTheme,
  getThemeColorForEngine,
  Themes,
} from '@src/lib/theme'
import { withWebSocketURL } from '@src/lib/withBaseURL'
import {
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  IEventListenerTracked,
  PendingMessage,
  UnreliableResponses,
  UnreliableSubscription,
} from './utils'
import {
  createOnDarkThemeMediaQueryChange,
  createOnEngineConnectionClosed,
  createOnEngineConnectionOpened,
  createOnEngineConnectionRestartRequest,
  createOnEngineConnectionStarted,
  createOnEngineOffline,
} from './connectionManagerEvents'
import type RustContext from '@src/lib/rustContext'
import { binaryToUuid, uuidv4 } from '@src/lib/utils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import CodeManager from '@src/lang/codeManager'
import { Models } from '@kittycad/lib/dist/types/src'
import { BSON } from 'bson'
import { EngineDebugger } from '@src/lib/debugger'
import { ResponseMap } from '@src/lang/std/artifactGraph'
import { CommandLog, CommandLogType } from '@src/lang/std/commandLog'

export class ConnectionManager extends EventTarget {
  started: boolean
  idleMode: boolean
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
  commandLogs: CommandLog[] = []

  connection: Connection | undefined
  sceneInfra: SceneInfra | undefined
  codeManager: CodeManager | undefined

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
  // Any event listener into this map to be cleaned up later
  // helps avoids duplicates as well
  allEventListeners: Map<string, IEventListenerTracked>

  constructor(settings?: SettingsViaQueryString) {
    super()
    this.started = false
    this.idleMode = false
    this.allEventListeners = new Map()
    this.id = uuidv4()

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
  }: {
    settings?: SettingsViaQueryString
    width: number
    height: number
    token: string
  }) {
    if (this.started) {
      throw new Error(
        'You tried to start the engine again, why are you starting it?'
      )
    }
    this.started = true

    if (this.connection) {
      throw new Error(
        'You tried to make a new connection. You already have one!'
      )
    }

    if (width <= 0) {
      throw new Error(`width is <=0, ${width}`)
    }

    if (height <= 0) {
      throw new Error(`height is <=0, ${height}`)
    }

    // Make sure dependencies exist during runtime otherwise crash!
    if (!this.rustContext) {
      throw new Error('rustContext is undefined')
    }
    1
    if (!this.sceneInfra) {
      throw new Error('sceneInfra is undefined')
    }

    if (settings) {
      this.settings = settings
    }

    this.streamDimensions = {
      width,
      height,
    }

    // Gotcha: do not proxy handleResize!
    // TODO: this.handleResize(this.streamDimensions); return;

    const url = this.generateWebsocketURL()
    this.connection = new Connection({
      connectionManager: this,
      url,
      token,
    })

    // TODO: This is gonna break instantly.
    if (!this.connection.peerConnection) {
      throw new Error('this.connection.peerConnection is undefined')
    }
    if (!this.connection.websocket) {
      throw new Error('this.connection.websocket is undefined')
    }
    // When is this.connection.connect() called?
    // onEngineConnectionStarted callback!

    // TODO:
    // Nothing more to do when using a lite engine initialization
    // if (callbackOnEngineLiteConnect) return

    this.dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.EngineAvailable, {
        detail: this.connection,
      })
    )

    const onEngineConnetionRestartRequest =
      createOnEngineConnectionRestartRequest({
        dispatchEvent: this.dispatchEvent.bind(this),
      })
    const onEngineOffline = createOnEngineOffline({
      dispatchEvent: this.dispatchEvent.bind(this),
    })

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
      callback: onEngineConnetionRestartRequest,
      type: 'connection',
    })
    this.connection.addEventListener(
      EngineConnectionEvents.RestartRequest,
      onEngineConnetionRestartRequest
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

    this.trackListener(EngineConnectionEvents.Opened, {
      event: EngineConnectionEvents.Opened,
      callback: onEngineConnectionOpened,
      type: 'connection',
    })
    this.connection.addEventListener(
      EngineConnectionEvents.Opened,
      onEngineConnectionOpened
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

  sendSceneCommand() {}

  // this.connection.websocket.addEventListener('message') handler
  handleMessage(event: MessageEvent) {
    if (!this.rustContext) {
      throw new Error('rustContext is undefined')
    }

    let message: Models['WebSocketResponse_type'] | null = null

    if (event.data instanceof ArrayBuffer) {
      // BSON deserialize the command
      message = BSON.deserialize(
        new Uint8Array(event.data)
      ) as Models['WebSocketResponse_type']
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
      EngineDebugger.addLog({
        label: 'handleMessage',
        message: 'message.request_id is missing',
      })
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
        (message.resp.type === 'modeling' ||
          message.resp.type === 'modeling_batch' ||
          message.resp.type === 'export')
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
        [key: string]: Models['WebSocketRequest_type']
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
    return await this.start({
      token,
      width: 256,
      height: 256,
    })
  }

  addCommandLog(message: CommandLog) {
    if (this.commandLogs.length > 500) {
      this.commandLogs.shift()
    }
    this.commandLogs.push(message)

    this._commandLogCallBack([...this.commandLogs])
  }

  registerCommandLogCallback(callback: (command: CommandLog[]) => void) {
    this._commandLogCallBack = callback
  }

  handleResize() {
    throw new Error('handleResize unimplemented, why are you doing this.')
  }

  tearDown(opts?: { idleMode: boolean }) {
    if (!this.connection) {
      throw new Error(
        'unable to tear down connectionManager, connection is missing'
      )
    }

    this.idleMode = opts?.idleMode ?? false

    if (this.connection) {
      for (const [cmdId, pending] of Object.entries(this.pendingCommands)) {
        pending.reject([
          {
            success: false,
            errors: [
              {
                error_code: 'connection_problem',
                message: 'no connection to send on, tearing down',
              },
            ],
          },
        ])
        delete this.pendingCommands[cmdId]
      }
    }

    this.removeAllEventListeners()
    this.connection.disconnectAll()
    this.connection = undefined

    // It is possible all connections never even started, but we still want
    // to signal to the whole application we are "offline".
    this.dispatchEvent(new CustomEvent(EngineCommandManagerEvents.Offline, {}))
  }

  // This is only metadata overhead to keep track of all the event listeners which allows for easy
  // removal during cleanUp. It can help prevent multiple runtime initializations of events.
  trackListener(name: string, eventListenerTracked: IEventListenerTracked) {
    if (this.allEventListeners.has(name)) {
      throw new Error(
        `You are trying to track something twice, good luck! you're crashing. ${name}`
      )
    }

    this.allEventListeners.set(name, eventListenerTracked)
  }

  removeAllEventListeners() {
    // Could hard code all the possible event keys and see if each one is removed.
    const listenersToRemove = Array.from(this.allEventListeners)

    listenersToRemove.forEach(
      ([event, eventListenerTracked]: [string, IEventListenerTracked]) => {
        const type = eventListenerTracked.type

        if (!this.connection) {
          throw new Error('unable to remove event listener on this.connection')
        }

        if (!this.connection.peerConnection) {
          throw new Error(
            'unable to remove event listener on this.connection.peerConnection'
          )
        }

        if (!this.connection.websocket) {
          throw new Error(
            'unable to remove event listener on this.connection.websocket'
          )
        }

        if (!darkModeMatcher) {
          throw new Error('unable to remove event listener on darkModeMatcher')
        }

        if (type === 'connection') {
          this.connection.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else if (type === 'darkModeMatcher') {
          darkModeMatcher.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else if (type === 'peerConnection') {
          this.connection.peerConnection.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else if (type === 'websocket') {
          this.connection.websocket.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else {
          throw new Error(`untracked listener type ${type}`)
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
}
