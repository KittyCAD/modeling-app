import { SourceRange } from 'lang/wasm'
import { Selections } from 'lib/selections'
import { VITE_KC_API_WS_MODELING_URL, VITE_KC_CONNECTION_TIMEOUT_MS } from 'env'
import { Models } from '@kittycad/lib'
import { exportSave } from 'lib/exportSave'
import { v4 as uuidv4 } from 'uuid'
import * as Sentry from '@sentry/react'
import { DefaultPlanes } from 'wasm-lib/kcl/bindings/DefaultPlanes'

let lastMessage = ''

interface CommandInfo {
  commandType: CommandTypes
  range: SourceRange
  parentId?: string
}

type WebSocketResponse = Models['OkWebSocketResponseData_type']

interface ResultCommand extends CommandInfo {
  type: 'result'
  data: any
  raw: WebSocketResponse
  headVertexId?: string
}
interface FailedCommand extends CommandInfo {
  type: 'failed'
  errors: Models['FailureWebSocketResponse_type']['errors']
}
interface PendingCommand extends CommandInfo {
  type: 'pending'
  promise: Promise<any>
  resolve: (val: any) => void
}

export interface ArtifactMap {
  [key: string]: ResultCommand | PendingCommand | FailedCommand
}

interface NewTrackArgs {
  conn: EngineConnection
  mediaStream: MediaStream
}

// This looks funny, I know. This is needed because node and the browser
// disagree as to the type. In a browser it's a number, but in node it's a
// "Timeout".
type Timeout = ReturnType<typeof setTimeout>

type ClientMetrics = Models['ClientMetrics_type']

// EngineConnection encapsulates the connection(s) to the Engine
// for the EngineCommandManager; namely, the underlying WebSocket
// and WebRTC connections.
export class EngineConnection {
  websocket?: WebSocket
  pc?: RTCPeerConnection
  unreliableDataChannel?: RTCDataChannel

  private ready: boolean
  private connecting: boolean
  private dead: boolean
  private failedConnTimeout: Timeout | null

  readonly url: string
  private readonly token?: string
  private onWebsocketOpen: (engineConnection: EngineConnection) => void
  private onDataChannelOpen: (engineConnection: EngineConnection) => void
  private onEngineConnectionOpen: (engineConnection: EngineConnection) => void
  private onConnectionStarted: (engineConnection: EngineConnection) => void
  private onClose: (engineConnection: EngineConnection) => void
  private onNewTrack: (track: NewTrackArgs) => void

  // TODO: actual type is ClientMetrics
  private webrtcStatsCollector?: () => Promise<ClientMetrics>

  constructor({
    url,
    token,
    onWebsocketOpen = () => {},
    onNewTrack = () => {},
    onEngineConnectionOpen = () => {},
    onConnectionStarted = () => {},
    onClose = () => {},
    onDataChannelOpen = () => {},
  }: {
    url: string
    token?: string
    onWebsocketOpen?: (engineConnection: EngineConnection) => void
    onDataChannelOpen?: (engineConnection: EngineConnection) => void
    onEngineConnectionOpen?: (engineConnection: EngineConnection) => void
    onConnectionStarted?: (engineConnection: EngineConnection) => void
    onClose?: (engineConnection: EngineConnection) => void
    onNewTrack?: (track: NewTrackArgs) => void
  }) {
    this.url = url
    this.token = token
    this.ready = false
    this.connecting = false
    this.dead = false
    this.failedConnTimeout = null
    this.onWebsocketOpen = onWebsocketOpen
    this.onDataChannelOpen = onDataChannelOpen
    this.onEngineConnectionOpen = onEngineConnectionOpen
    this.onConnectionStarted = onConnectionStarted
    this.onClose = onClose
    this.onNewTrack = onNewTrack

    // TODO(paultag): This ought to be tweakable.
    const pingIntervalMs = 10000

    let pingInterval = setInterval(() => {
      if (this.dead) {
        clearInterval(pingInterval)
      }
      if (this.isReady()) {
        // When we're online, every 10 seconds, we'll attempt to put a 'ping'
        // command through the WebSocket connection. This will help both ends
        // of the connection maintain the TCP connection without hitting a
        // timeout condition.
        this.send({ type: 'ping' })
      }
    }, pingIntervalMs)

    const connectionTimeoutMs = VITE_KC_CONNECTION_TIMEOUT_MS
    let connectInterval = setInterval(() => {
      if (this.dead) {
        clearInterval(connectInterval)
        return
      }
      if (this.isReady()) {
        return
      }
      console.log('connecting via retry')
      this.connect()
    }, connectionTimeoutMs)
  }
  // isConnecting will return true when connect has been called, but the full
  // WebRTC is not online.
  isConnecting() {
    return this.connecting
  }
  // isReady will return true only when the WebRTC *and* WebSocket connection
  // are connected. During setup, the WebSocket connection comes online first,
  // which is used to establish the WebRTC connection. The EngineConnection
  // is not "Ready" until both are connected.
  isReady() {
    return this.ready
  }
  tearDown() {
    this.dead = true
    this.close()
  }
  // shouldTrace will return true when Sentry should be used to instrument
  // the Engine.
  shouldTrace() {
    return Sentry.getCurrentHub()?.getClient()?.getOptions()?.sendClientReports
  }
  // connect will attempt to connect to the Engine over a WebSocket, and
  // establish the WebRTC connections.
  //
  // This will attempt the full handshake, and retry if the connection
  // did not establish.
  connect() {
    console.log('connect was called')
    if (this.isConnecting() || this.isReady()) {
      return
    }

    // Information on the connect transaction

    class SpanPromise {
      span: Sentry.Span
      promise: Promise<void>
      resolve?: (v: void) => void

      constructor(span: Sentry.Span) {
        this.span = span
        this.promise = new Promise((resolve) => {
          this.resolve = (v: void) => {
            // here we're going to invoke finish before resolving the
            // promise so that a `.then()` will order strictly after
            // all spans have -- for sure -- been resolved, rather than
            // doing a `then` on this promise.
            this.span.finish()
            resolve(v)
          }
        })
      }
    }

    let webrtcMediaTransaction: Sentry.Transaction
    let websocketSpan: SpanPromise
    let mediaTrackSpan: SpanPromise
    let dataChannelSpan: SpanPromise
    let handshakeSpan: SpanPromise
    let iceSpan: SpanPromise

    if (this.shouldTrace()) {
      webrtcMediaTransaction = Sentry.startTransaction({
        name: 'webrtc-media',
      })
      websocketSpan = new SpanPromise(
        webrtcMediaTransaction.startChild({ op: 'websocket' })
      )
    }

    this.websocket = new WebSocket(this.url, [])
    this.websocket.binaryType = 'arraybuffer'

    this.pc = new RTCPeerConnection()
    this.pc.createDataChannel('unreliable_modeling_cmds')
    this.websocket.addEventListener('open', (event) => {
      console.log('Connected to websocket, waiting for ICE servers')
      if (this.token) {
        this.send({ headers: { Authorization: `Bearer ${this.token}` } })
      }
    })

    this.websocket.addEventListener('open', (event) => {
      if (this.shouldTrace()) {
        websocketSpan.resolve?.()

        handshakeSpan = new SpanPromise(
          webrtcMediaTransaction.startChild({ op: 'handshake' })
        )
        iceSpan = new SpanPromise(
          webrtcMediaTransaction.startChild({ op: 'ice' })
        )
        dataChannelSpan = new SpanPromise(
          webrtcMediaTransaction.startChild({
            op: 'data-channel',
          })
        )
        mediaTrackSpan = new SpanPromise(
          webrtcMediaTransaction.startChild({
            op: 'media-track',
          })
        )
      }

      if (this.shouldTrace()) {
        Promise.all([
          handshakeSpan.promise,
          iceSpan.promise,
          dataChannelSpan.promise,
          mediaTrackSpan.promise,
        ]).then(() => {
          console.log('All spans finished, reporting')
          webrtcMediaTransaction?.finish()
        })
      }

      this.onWebsocketOpen(this)
    })

    this.websocket.addEventListener('close', (event) => {
      console.log('websocket connection closed', event)
      this.close()
    })

    this.websocket.addEventListener('error', (event) => {
      console.log('websocket connection error', event)
      this.close()
    })

    this.websocket.addEventListener('message', (event) => {
      // In the EngineConnection, we're looking for messages to/from
      // the server that relate to the ICE handshake, or WebRTC
      // negotiation. There may be other messages (including ArrayBuffer
      // messages) that are intended for the GUI itself, so be careful
      // when assuming we're the only consumer or that all messages will
      // be carefully formatted here.

      if (typeof event.data !== 'string') {
        return
      }

      const message: Models['WebSocketResponse_type'] = JSON.parse(event.data)

      if (!message.success) {
        const errorsString = message?.errors
          ?.map((error) => {
            return `  - ${error.error_code}: ${error.message}`
          })
          .join('\n')
        if (message.request_id) {
          console.error(
            `Error in response to request ${message.request_id}:\n${errorsString}`
          )
        } else {
          console.error(`Error from server:\n${errorsString}`)
        }
        return
      }

      let resp = message.resp
      if (!resp) {
        // If there's no body to the response, we can bail here.
        return
      }

      if (resp.type === 'sdp_answer') {
        let answer = resp.data?.answer
        if (!answer || answer.type === 'unspecified') {
          return
        }

        if (this.pc?.signalingState !== 'stable') {
          // If the connection is stable, we shouldn't bother updating the
          // SDP, since we have a stable connection to the backend. If we
          // need to renegotiate, the whole PeerConnection needs to get
          // tore down.
          this.pc?.setRemoteDescription(
            new RTCSessionDescription({
              type: answer.type,
              sdp: answer.sdp,
            })
          )

          if (this.shouldTrace()) {
            // When both ends have a local and remote SDP, we've been able to
            // set up successfully. We'll still need to find the right ICE
            // servers, but this is hand-shook.
            handshakeSpan.resolve?.()
          }
        }
      } else if (resp.type === 'trickle_ice') {
        let candidate = resp.data?.candidate
        this.pc?.addIceCandidate(candidate as RTCIceCandidateInit)
      } else if (resp.type === 'ice_server_info' && this.pc) {
        console.log('received ice_server_info')
        let ice_servers = resp.data?.ice_servers

        if (ice_servers?.length > 0) {
          // When we set the Configuration, we want to always force
          // iceTransportPolicy to 'relay', since we know the topology
          // of the ICE/STUN/TUN server and the engine. We don't wish to
          // talk to the engine in any configuration /other/ than relay
          // from a infra POV.
          this.pc.setConfiguration({
            iceServers: ice_servers,
            iceTransportPolicy: 'relay',
          })
        } else {
          this.pc?.setConfiguration({})
        }

        // We have an ICE Servers set now. We just setConfiguration, so let's
        // start adding things we care about to the PeerConnection and let
        // ICE negotiation happen in the background. Everything from here
        // until the end of this function is setup of our end of the
        // PeerConnection and waiting for events to fire our callbacks.

        this.pc.addEventListener('connectionstatechange', (event) => {
          if (this.pc?.iceConnectionState === 'connected') {
            if (this.shouldTrace()) {
              iceSpan.resolve?.()
            }
          } else if (this.pc?.iceConnectionState === 'failed') {
            // failed is a terminal state; let's explicitly kill the
            // connection to the server at this point.
            console.log('failed to negotiate ice connection; restarting')
            this.close()
          }
        })

        this.pc.addEventListener('icecandidate', (event) => {
          if (!this.pc || !this.websocket) return
          if (event.candidate !== null) {
            console.log('sending trickle ice candidate')
            const { candidate } = event
            this.send({
              type: 'trickle_ice',
              candidate: candidate.toJSON(),
            })
          }
        })

        // Offer to receive 1 video track
        this.pc.addTransceiver('video', {})

        // Finally (but actually firstly!), to kick things off, we're going to
        // generate our SDP, set it on our PeerConnection, and let the server
        // know about our capabilities.
        this.pc
          .createOffer()
          .then(async (descriptionInit) => {
            await this?.pc?.setLocalDescription(descriptionInit)
            console.log('sent sdp_offer begin')
            this.send({
              type: 'sdp_offer',
              offer: this.pc?.localDescription,
            })
          })
          .catch(console.log)
      } else if (resp.type === 'metrics_request') {
        if (this.webrtcStatsCollector === undefined) {
          // TODO: Error message here?
          return
        }
        this.webrtcStatsCollector().then((client_metrics) => {
          this.send({
            type: 'metrics_response',
            metrics: client_metrics,
          })
        })
      }
    })

    this.pc.addEventListener('track', (event) => {
      const mediaStream = event.streams[0]

      if (this.shouldTrace()) {
        let mediaStreamTrack = mediaStream.getVideoTracks()[0]
        mediaStreamTrack.addEventListener('unmute', () => {
          // let settings = mediaStreamTrack.getSettings()
          // mediaTrackSpan.span.setTag("fps", settings.frameRate)
          // mediaTrackSpan.span.setTag("width", settings.width)
          // mediaTrackSpan.span.setTag("height", settings.height)
          mediaTrackSpan.resolve?.()
        })
      }

      this.webrtcStatsCollector = (): Promise<ClientMetrics> => {
        return new Promise((resolve, reject) => {
          if (mediaStream.getVideoTracks().length !== 1) {
            reject(new Error('too many video tracks to report'))
            return
          }

          let videoTrack = mediaStream.getVideoTracks()[0]
          this.pc?.getStats(videoTrack).then((videoTrackStats) => {
            let client_metrics: ClientMetrics = {
              rtc_frames_decoded: 0,
              rtc_frames_dropped: 0,
              rtc_frames_received: 0,
              rtc_frames_per_second: 0,
              rtc_freeze_count: 0,
              rtc_jitter_sec: 0.0,
              rtc_keyframes_decoded: 0,
              rtc_total_freezes_duration_sec: 0.0,
            }

            // TODO(paultag): Since we can technically have multiple WebRTC
            // video tracks (even if the Server doesn't at the moment), we
            // ought to send stats for every video track(?), and add the stream
            // ID into it.  This raises the cardinality of collected metrics
            // when/if we do, but for now, just report the one stream.

            videoTrackStats.forEach((videoTrackReport) => {
              if (videoTrackReport.type === 'inbound-rtp') {
                client_metrics.rtc_frames_decoded =
                  videoTrackReport.framesDecoded
                client_metrics.rtc_frames_dropped =
                  videoTrackReport.framesDropped
                client_metrics.rtc_frames_received =
                  videoTrackReport.framesReceived
                client_metrics.rtc_frames_per_second =
                  videoTrackReport.framesPerSecond || 0
                client_metrics.rtc_freeze_count =
                  videoTrackReport.freezeCount || 0
                client_metrics.rtc_jitter_sec = videoTrackReport.jitter
                client_metrics.rtc_keyframes_decoded =
                  videoTrackReport.keyFramesDecoded
                client_metrics.rtc_total_freezes_duration_sec =
                  videoTrackReport.totalFreezesDuration || 0
              } else if (videoTrackReport.type === 'transport') {
                // videoTrackReport.bytesReceived,
                // videoTrackReport.bytesSent,
              }
            })
            resolve(client_metrics)
          })
        })
      }

      this.onNewTrack({
        conn: this,
        mediaStream: mediaStream,
      })
    })

    this.pc.addEventListener('datachannel', (event) => {
      this.unreliableDataChannel = event.channel

      console.log('accepted unreliable data channel', event.channel.label)
      this.unreliableDataChannel.addEventListener('open', (event) => {
        console.log('unreliable data channel opened', event)
        if (this.shouldTrace()) {
          dataChannelSpan.resolve?.()
        }

        this.onDataChannelOpen(this)

        this.ready = true
        this.connecting = false
        // Do this after we set the connection is ready to avoid errors when
        // we try to send messages before the connection is ready.
        this.onEngineConnectionOpen(this)
      })

      this.unreliableDataChannel.addEventListener('close', (event) => {
        console.log('unreliable data channel closed')
        this.close()
      })

      this.unreliableDataChannel.addEventListener('error', (event) => {
        console.log('unreliable data channel error')
        this.close()
      })
    })

    const connectionTimeoutMs = VITE_KC_CONNECTION_TIMEOUT_MS

    if (this.failedConnTimeout) {
      console.log('clearing timeout before set')
      clearTimeout(this.failedConnTimeout)
      this.failedConnTimeout = null
    }
    console.log('timeout set')
    this.failedConnTimeout = setTimeout(() => {
      if (this.isReady()) {
        return
      }
      console.log('engine connection timeout on connection, closing')
      this.close()
    }, connectionTimeoutMs)

    this.onConnectionStarted(this)
  }
  unreliableSend(message: object | string) {
    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.unreliableDataChannel?.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }
  send(message: object | string) {
    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.websocket?.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }
  close() {
    this.websocket?.close()
    this.pc?.close()
    this.unreliableDataChannel?.close()
    this.websocket = undefined
    this.pc = undefined
    this.unreliableDataChannel = undefined
    this.webrtcStatsCollector = undefined
    if (this.failedConnTimeout) {
      console.log('closed timeout in close')
      clearTimeout(this.failedConnTimeout)
      this.failedConnTimeout = null
    }

    this.onClose(this)
    this.ready = false
    this.connecting = false
  }
}

export type EngineCommand = Models['WebSocketRequest_type']
type ModelTypes = Models['OkModelingCmdResponse_type']['type']

type CommandTypes = Models['ModelingCmd_type']['type']

type UnreliableResponses = Extract<
  Models['OkModelingCmdResponse_type'],
  { type: 'highlight_set_entity' }
>
interface UnreliableSubscription<T extends UnreliableResponses['type']> {
  event: T
  callback: (data: Extract<UnreliableResponses, { type: T }>) => void
}

interface Subscription<T extends ModelTypes> {
  event: T
  callback: (
    data: Extract<Models['OkModelingCmdResponse_type'], { type: T }>
  ) => void
}

export class EngineCommandManager {
  artifactMap: ArtifactMap = {}
  outSequence = 1
  inSequence = 1
  engineConnection?: EngineConnection
  defaultPlanes: DefaultPlanes = { xy: '', yz: '', xz: '' }
  // Folks should realize that wait for ready does not get called _everytime_
  // the connection resets and restarts, it only gets called the first time.
  // Be careful what you put here.
  private resolveReady = () => {}
  waitForReady: Promise<void> = new Promise((resolve) => {
    this.resolveReady = resolve
  })

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

  constructor() {
    this.engineConnection = undefined
  }

  start({
    setMediaStream,
    setIsStreamReady,
    width,
    height,
    executeCode,
    token,
  }: {
    setMediaStream: (stream: MediaStream) => void
    setIsStreamReady: (isStreamReady: boolean) => void
    width: number
    height: number
    executeCode: (code?: string, force?: boolean) => void
    token?: string
  }) {
    if (width === 0 || height === 0) {
      return
    }

    // If we already have an engine connection, just need to resize the stream.
    if (this.engineConnection) {
      this.handleResize({ streamWidth: width, streamHeight: height })
      return
    }

    const url = `${VITE_KC_API_WS_MODELING_URL}?video_res_width=${width}&video_res_height=${height}`
    this.engineConnection = new EngineConnection({
      url,
      token,
      onEngineConnectionOpen: () => {
        this.resolveReady()
        setIsStreamReady(true)

        // Make the axis gizmo.
        // We do this after the connection opened to avoid a race condition.
        // Connected opened is the last thing that happens when the stream
        // is ready.
        // We also do this here because we want to ensure we create the gizmo
        // and execute the code everytime the stream is restarted.
        const gizmoId = uuidv4()
        this.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: gizmoId,
          cmd: {
            type: 'make_axes_gizmo',
            clobber: false,
            // If true, axes gizmo will be placed in the corner of the screen.
            // If false, it will be placed at the origin of the scene.
            gizmo_mode: true,
          },
        })

        // Inisialize the planes.
        this.initPlanes().then(() => {
          // We execute the code here to make sure if the stream was to
          // restart in a session, we want to make sure to execute the code.
          // We force it to re-execute the code because we want to make sure
          // the code is executed everytime the stream is restarted.
          // We pass undefined for the code so it reads from the current state.
          executeCode(undefined, true)
        })
      },
      onClose: () => {
        setIsStreamReady(false)
      },
      onConnectionStarted: (engineConnection) => {
        engineConnection?.pc?.addEventListener('datachannel', (event) => {
          let unreliableDataChannel = event.channel

          unreliableDataChannel.addEventListener('message', (event) => {
            const result: UnreliableResponses = JSON.parse(event.data)
            Object.values(
              this.unreliableSubscriptions[result.type] || {}
            ).forEach(
              // TODO: There is only one response that uses the unreliable channel atm,
              // highlight_set_entity, if there are more it's likely they will all have the same
              // sequence logic, but I'm not sure if we use a single global sequence or a sequence
              // per unreliable subscription.
              (callback) => {
                if (
                  result?.data?.sequence &&
                  result?.data.sequence > this.inSequence &&
                  result.type === 'highlight_set_entity'
                ) {
                  this.inSequence = result.data.sequence
                  callback(result)
                }
              }
            )
          })
        })

        // When the EngineConnection starts a connection, we want to register
        // callbacks into the WebSocket/PeerConnection.
        engineConnection.websocket?.addEventListener('message', (event) => {
          if (event.data instanceof ArrayBuffer) {
            // If the data is an ArrayBuffer, it's  the result of an export command,
            // because in all other cases we send JSON strings. But in the case of
            // export we send a binary blob.
            // Pass this to our export function.
            exportSave(event.data)
          } else {
            const message: Models['WebSocketResponse_type'] = JSON.parse(
              event.data
            )
            if (
              message.success &&
              message.resp.type === 'modeling' &&
              message.request_id
            ) {
              this.handleModelingCommand(message.resp, message.request_id)
            } else if (
              !message.success &&
              message.request_id &&
              this.artifactMap[message.request_id]
            ) {
              this.handleFailedModelingCommand(message)
            }
          }
        })
      },
      onNewTrack: ({ mediaStream }) => {
        console.log('received track', mediaStream)

        mediaStream.getVideoTracks()[0].addEventListener('mute', () => {
          console.log('peer is not sending video to us')
          // this.engineConnection?.close()
          // this.engineConnection?.connect()
        })

        setMediaStream(mediaStream)
      },
    })

    this.engineConnection?.connect()
  }
  handleResize({
    streamWidth,
    streamHeight,
  }: {
    streamWidth: number
    streamHeight: number
  }) {
    if (!this.engineConnection?.isReady()) {
      return
    }

    const resizeCmd: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'reconfigure_stream',
        width: streamWidth,
        height: streamHeight,
        fps: 60,
      },
    }
    this.engineConnection?.send(resizeCmd)
  }
  handleModelingCommand(message: WebSocketResponse, id: string) {
    if (message.type !== 'modeling') {
      return
    }
    const modelingResponse = message.data.modeling_response
    Object.values(this.subscriptions[modelingResponse.type] || {}).forEach(
      (callback) => callback(modelingResponse)
    )

    const command = this.artifactMap[id]
    if (command && command.type === 'pending') {
      const resolve = command.resolve
      this.artifactMap[id] = {
        type: 'result',
        range: command.range,
        commandType: command.commandType,
        parentId: command.parentId ? command.parentId : undefined,
        data: modelingResponse,
        raw: message,
      }
      resolve({
        id,
        commandType: command.commandType,
        range: command.range,
        data: modelingResponse,
        raw: message,
      })
    } else {
      this.artifactMap[id] = {
        type: 'result',
        commandType: command?.commandType,
        range: command?.range,
        data: modelingResponse,
        raw: message,
      }
    }
  }
  handleFailedModelingCommand({
    request_id,
    errors,
  }: Models['FailureWebSocketResponse_type']) {
    const id = request_id
    if (!id) return
    const command = this.artifactMap[id]
    if (command && command.type === 'pending') {
      const resolve = command.resolve
      this.artifactMap[id] = {
        type: 'failed',
        range: command.range,
        commandType: command.commandType,
        parentId: command.parentId ? command.parentId : undefined,
        errors,
      }
      resolve({
        id,
        commandType: command.commandType,
        range: command.range,
        errors,
      })
    } else {
      this.artifactMap[id] = {
        type: 'failed',
        range: command.range,
        commandType: command.commandType,
        parentId: command.parentId ? command.parentId : undefined,
        errors,
      }
    }
  }
  tearDown() {
    this.engineConnection?.tearDown()
  }
  startNewSession() {
    this.artifactMap = {}
  }
  subscribeTo<T extends ModelTypes>({
    event,
    callback,
  }: Subscription<T>): () => void {
    const localUnsubscribeId = uuidv4()
    const otherEventCallbacks = this.subscriptions[event]
    if (otherEventCallbacks) {
      otherEventCallbacks[localUnsubscribeId] = callback
    } else {
      this.subscriptions[event] = {
        [localUnsubscribeId]: callback,
      }
    }
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
    const otherEventCallbacks = this.unreliableSubscriptions[event]
    if (otherEventCallbacks) {
      otherEventCallbacks[localUnsubscribeId] = callback
    } else {
      this.unreliableSubscriptions[event] = {
        [localUnsubscribeId]: callback,
      }
    }
    return () => this.unSubscribeToUnreliable(event, localUnsubscribeId)
  }
  private unSubscribeToUnreliable(
    event: UnreliableResponses['type'],
    id: string
  ) {
    delete this.unreliableSubscriptions[event][id]
  }
  endSession() {
    // TODO: instead of sending a single command with `object_ids: Object.keys(this.artifactMap)`
    // we need to loop over them each individualy because if the engine doesn't recognise a single
    // id the whole command fails.
    Object.entries(this.artifactMap).forEach(([id, artifact]) => {
      const artifactTypesToDelete: ArtifactMap[string]['commandType'][] = [
        // 'start_path' creates a new scene object for the path, which is why it needs to be deleted,
        // however all of the segments in the path are its children so there don't need to be deleted.
        // this fact is very opaque in the api and docs (as to what should can be deleted).
        // Using an array is the list is likely to grow.
        'start_path',
      ]
      if (!artifactTypesToDelete.includes(artifact.commandType)) return

      const deletCmd: EngineCommand = {
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'remove_scene_objects',
          object_ids: [id],
        },
      }
      this.engineConnection?.send(deletCmd)
    })
  }
  cusorsSelected(selections: {
    otherSelections: Selections['otherSelections']
    idBasedSelections: { type: string; id: string }[]
  }) {
    if (!this.engineConnection?.isReady()) {
      console.log('engine connection isnt ready')
      return
    }
    this.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_clear',
      },
      cmd_id: uuidv4(),
    })
    this.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'select_add',
        entities: selections.idBasedSelections.map((s) => s.id),
      },
      cmd_id: uuidv4(),
    })
  }
  sendSceneCommand(command: EngineCommand): Promise<any> {
    if (this.engineConnection === undefined) {
      return Promise.resolve()
    }

    if (!this.engineConnection?.isReady()) {
      return Promise.resolve()
    }

    if (
      command.type === 'modeling_cmd_req' &&
      command.cmd.type !== lastMessage
    ) {
      console.log('sending command', command.cmd.type)
      lastMessage = command.cmd.type
    }
    if (command.type !== 'modeling_cmd_req') return Promise.resolve()
    const cmd = command.cmd
    if (
      (cmd.type === 'camera_drag_move' ||
        cmd.type === 'handle_mouse_drag_move') &&
      this.engineConnection?.unreliableDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.unreliableSend(command)
      return Promise.resolve()
    } else if (
      cmd.type === 'highlight_set_entity' &&
      this.engineConnection?.unreliableDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.unreliableSend(command)
      return Promise.resolve()
    } else if (
      cmd.type === 'mouse_move' &&
      this.engineConnection.unreliableDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.unreliableSend(command)
      return Promise.resolve()
    }
    // since it's not mouse drag or highlighting send over TCP and keep track of the command
    this.engineConnection?.send(command)
    return this.handlePendingCommand(command.cmd_id, command.cmd)
  }
  sendModelingCommand({
    id,
    range,
    command,
  }: {
    id: string
    range: SourceRange
    command: EngineCommand | string
  }): Promise<any> {
    if (this.engineConnection === undefined) {
      return Promise.resolve()
    }

    if (!this.engineConnection?.isReady()) {
      return Promise.resolve()
    }
    this.engineConnection?.send(command)
    if (typeof command !== 'string' && command.type === 'modeling_cmd_req') {
      return this.handlePendingCommand(id, command?.cmd, range)
    } else if (typeof command === 'string') {
      const parseCommand: EngineCommand = JSON.parse(command)
      if (parseCommand.type === 'modeling_cmd_req')
        return this.handlePendingCommand(id, parseCommand?.cmd, range)
    }
    throw 'shouldnt reach here'
  }
  handlePendingCommand(
    id: string,
    command: Models['ModelingCmd_type'],
    range?: SourceRange
  ) {
    let resolve: (val: any) => void = () => {}
    const promise = new Promise((_resolve, reject) => {
      resolve = _resolve
    })
    const getParentId = (): string | undefined => {
      if (command.type === 'extend_path') {
        return command.path
      }
      // TODO handle other commands that have a parent
    }
    this.artifactMap[id] = {
      range: range || [0, 0],
      type: 'pending',
      commandType: command.type,
      parentId: getParentId(),
      promise,
      resolve,
    }
    return promise
  }
  sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string
  ): Promise<any> {
    if (this.engineConnection === undefined) {
      return Promise.resolve()
    }
    if (id === undefined) {
      throw new Error('id is undefined')
    }
    if (rangeStr === undefined) {
      throw new Error('rangeStr is undefined')
    }
    if (commandStr === undefined) {
      throw new Error('commandStr is undefined')
    }
    const range: SourceRange = JSON.parse(rangeStr)

    // We only care about the modeling command response.
    return this.sendModelingCommand({ id, range, command: commandStr }).then(
      ({ raw }) => JSON.stringify(raw)
    )
  }
  commandResult(id: string): Promise<any> {
    const command = this.artifactMap[id]
    if (!command) {
      throw new Error('No command found')
    }
    if (command.type === 'result') {
      return command.data
    } else if (command.type === 'failed') {
      return Promise.resolve(command.errors)
    }
    return command.promise
  }
  async waitForAllCommands(): Promise<{
    artifactMap: ArtifactMap
  }> {
    const pendingCommands = Object.values(this.artifactMap).filter(
      ({ type }) => type === 'pending'
    ) as PendingCommand[]
    const proms = pendingCommands.map(({ promise }) => promise)
    await Promise.all(proms)

    return {
      artifactMap: this.artifactMap,
    }
  }
  private async initPlanes() {
    const [xy, yz, xz] = [
      await this.createPlane({
        x_axis: { x: 1, y: 0, z: 0 },
        y_axis: { x: 0, y: 1, z: 0 },
        color: { r: 0.7, g: 0.28, b: 0.28, a: 0.4 },
      }),
      await this.createPlane({
        x_axis: { x: 0, y: 1, z: 0 },
        y_axis: { x: 0, y: 0, z: 1 },
        color: { r: 0.28, g: 0.7, b: 0.28, a: 0.4 },
      }),
      await this.createPlane({
        x_axis: { x: 1, y: 0, z: 0 },
        y_axis: { x: 0, y: 0, z: 1 },
        color: { r: 0.28, g: 0.28, b: 0.7, a: 0.4 },
      }),
    ]
    this.defaultPlanes = { xy, yz, xz }

    this.subscribeTo({
      event: 'select_with_point',
      callback: ({ data }) => {
        if (!data?.entity_id) return
        if (
          ![
            this.defaultPlanes.xy,
            this.defaultPlanes.yz,
            this.defaultPlanes.xz,
          ].includes(data.entity_id)
        )
          return
        this.onPlaneSelectCallback(data.entity_id)
      },
    })
  }
  planesInitialized(): boolean {
    return (
      this.defaultPlanes.xy !== '' &&
      this.defaultPlanes.yz !== '' &&
      this.defaultPlanes.xz !== ''
    )
  }

  onPlaneSelectCallback = (id: string) => {}
  onPlaneSelected(callback: (id: string) => void) {
    this.onPlaneSelectCallback = callback
  }

  async setPlaneHidden(id: string, hidden: boolean): Promise<string> {
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

  private async createPlane({
    x_axis,
    y_axis,
    color,
  }: {
    x_axis: Models['Point3d_type']
    y_axis: Models['Point3d_type']
    color: Models['Color_type']
  }): Promise<string> {
    const planeId = uuidv4()
    await this.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'make_plane',
        size: 60,
        origin: { x: 0, y: 0, z: 0 },
        x_axis,
        y_axis,
        clobber: false,
        hide: true,
      },
      cmd_id: planeId,
    })
    await this.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'plane_set_color',
        plane_id: planeId,
        color,
      },
      cmd_id: uuidv4(),
    })
    await this.setPlaneHidden(planeId, true)
    return planeId
  }
}

export const engineCommandManager = new EngineCommandManager()
