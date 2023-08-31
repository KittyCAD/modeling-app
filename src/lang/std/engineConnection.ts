import { SourceRange } from 'lang/executor'
import { Selections } from 'useStore'
import {
  VITE_KC_API_WS_MODELING_URL,
  VITE_KC_CONNECTION_TIMEOUT_MS,
  VITE_KC_CONNECTION_WEBRTC_REPORT_STATS_MS,
} from 'env'
import { Models } from '@kittycad/lib'
import { exportSave } from 'lib/exportSave'
import { v4 as uuidv4 } from 'uuid'
import * as Sentry from '@sentry/react'

interface ResultCommand {
  type: 'result'
  data: any
}
interface PendingCommand {
  type: 'pending'
  promise: Promise<any>
  resolve: (val: any) => void
}

export interface ArtifactMap {
  [key: string]: ResultCommand | PendingCommand
}
export interface SourceRangeMap {
  [key: string]: SourceRange
}

interface NewTrackArgs {
  conn: EngineConnection
  mediaStream: MediaStream
}

type WebSocketResponse = Models['OkWebSocketResponseData_type']

// EngineConnection encapsulates the connection(s) to the Engine
// for the EngineCommandManager; namely, the underlying WebSocket
// and WebRTC connections.
export class EngineConnection {
  websocket?: WebSocket
  pc?: RTCPeerConnection
  unreliableDataChannel?: RTCDataChannel

  private ready: boolean

  readonly url: string
  private readonly token?: string
  private onWebsocketOpen: (engineConnection: EngineConnection) => void
  private onDataChannelOpen: (engineConnection: EngineConnection) => void
  private onEngineConnectionOpen: (engineConnection: EngineConnection) => void
  private onConnectionStarted: (engineConnection: EngineConnection) => void
  private onClose: (engineConnection: EngineConnection) => void
  private onNewTrack: (track: NewTrackArgs) => void

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
    this.onWebsocketOpen = onWebsocketOpen
    this.onDataChannelOpen = onDataChannelOpen
    this.onEngineConnectionOpen = onEngineConnectionOpen
    this.onConnectionStarted = onConnectionStarted
    this.onClose = onClose
    this.onNewTrack = onNewTrack

    // TODO(paultag): This ought to be tweakable.
    const pingIntervalMs = 10000

    setInterval(() => {
      if (this.isReady()) {
        // When we're online, every 10 seconds, we'll attempt to put a 'ping'
        // command through the WebSocket connection. This will help both ends
        // of the connection maintain the TCP connection without hitting a
        // timeout condition.
        this.send({ type: 'ping' })
      }
    }, pingIntervalMs)
  }
  // isReady will return true only when the WebRTC *and* WebSocket connection
  // are connected. During setup, the WebSocket connection comes online first,
  // which is used to establish the WebRTC connection. The EngineConnection
  // is not "Ready" until both are connected.
  isReady() {
    return this.ready
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
    // TODO(paultag): make this safe to call multiple times, and figure out
    // when a connection is in progress (state: connecting or something).

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

      Promise.all([
        handshakeSpan.promise,
        iceSpan.promise,
        dataChannelSpan.promise,
        mediaTrackSpan.promise,
      ]).then(() => {
        console.log('All spans finished, reporting')
        webrtcMediaTransaction?.finish()
      })

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
        if (message.request_id) {
          console.error(`Error in response to request ${message.request_id}:`)
        } else {
          console.error(`Error from server:`)
        }
        message?.errors?.forEach((error) => {
          console.error(` - ${error.error_code}: ${error.message}`)
        })
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
            iceSpan.resolve?.()
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
      }

      // TODO(paultag): This ought to be both controllable, as well as something
      // like exponential backoff to have some grace on the backend, as well as
      // fix responsiveness for clients that had a weird network hiccup.
      const connectionTimeoutMs = VITE_KC_CONNECTION_TIMEOUT_MS

      setTimeout(() => {
        if (this.isReady()) {
          return
        }
        console.log('engine connection timeout on connection, retrying')
        this.close()
        this.connect()
      }, connectionTimeoutMs)
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

      // Set up the background thread to keep an eye on statistical
      // information about the WebRTC media stream from the server to
      // us. We'll also eventually want more global statistical information,
      // but this will give us a baseline.
      if (parseInt(VITE_KC_CONNECTION_WEBRTC_REPORT_STATS_MS) !== 0) {
        setInterval(() => {
          if (this.pc === undefined) {
            return
          }
          if (!this.shouldTrace()) {
            return
          }

          // Use the WebRTC Statistics API to collect statistical information
          // about the WebRTC connection we're using to report to Sentry.
          mediaStream.getVideoTracks().forEach((videoTrack) => {
            let trackStats = new Map<string, any>()
            this.pc?.getStats(videoTrack).then((videoTrackStats) => {
              // Sentry only allows 10 metrics per transaction. We're going
              // to have to pick carefully here, eventually send like a prom
              // file or something to the peer.

              const transaction = Sentry.startTransaction({
                name: 'webrtc-stats',
              })
              videoTrackStats.forEach((videoTrackReport) => {
                if (videoTrackReport.type === 'inbound-rtp') {
                  // RTC Stream Info
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.framesDecoded',
                  //   videoTrackReport.framesDecoded,
                  //   'frame'
                  // )
                  transaction.setMeasurement(
                    'rtcFramesDropped',
                    videoTrackReport.framesDropped,
                    ''
                  )
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.framesReceived',
                  //   videoTrackReport.framesReceived,
                  //   'frame'
                  // )
                  transaction.setMeasurement(
                    'rtcFramesPerSecond',
                    videoTrackReport.framesPerSecond,
                    'fps'
                  )
                  transaction.setMeasurement(
                    'rtcFreezeCount',
                    videoTrackReport.freezeCount,
                    ''
                  )
                  transaction.setMeasurement(
                    'rtcJitter',
                    videoTrackReport.jitter,
                    'second'
                  )
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.jitterBufferDelay',
                  //   videoTrackReport.jitterBufferDelay,
                  //   ''
                  // )
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.jitterBufferEmittedCount',
                  //   videoTrackReport.jitterBufferEmittedCount,
                  //   ''
                  // )
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.jitterBufferMinimumDelay',
                  //   videoTrackReport.jitterBufferMinimumDelay,
                  //   ''
                  // )
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.jitterBufferTargetDelay',
                  //   videoTrackReport.jitterBufferTargetDelay,
                  //   ''
                  // )
                  transaction.setMeasurement(
                    'rtcKeyFramesDecoded',
                    videoTrackReport.keyFramesDecoded,
                    ''
                  )
                  transaction.setMeasurement(
                    'rtcTotalFreezesDuration',
                    videoTrackReport.totalFreezesDuration,
                    'second'
                  )
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.totalInterFrameDelay',
                  //   videoTrackReport.totalInterFrameDelay,
                  //   ''
                  // )
                  transaction.setMeasurement(
                    'rtcTotalPausesDuration',
                    videoTrackReport.totalPausesDuration,
                    'second'
                  )
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.totalProcessingDelay',
                  //   videoTrackReport.totalProcessingDelay,
                  //   'second'
                  // )
                } else if (videoTrackReport.type === 'transport') {
                  // // Bytes i/o
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.bytesReceived',
                  //   videoTrackReport.bytesReceived,
                  //   'byte'
                  // )
                  // transaction.setMeasurement(
                  //   'mediaStreamTrack.bytesSent',
                  //   videoTrackReport.bytesSent,
                  //   'byte'
                  // )
                }
              })
              transaction?.finish()
            })
          })
        }, VITE_KC_CONNECTION_WEBRTC_REPORT_STATS_MS)
      }

      this.onNewTrack({
        conn: this,
        mediaStream: mediaStream,
      })
    })

    // During startup, we'll track the time from `connect` being called
    // until the 'done' event fires.
    let connectionStarted = new Date()

    this.pc.addEventListener('datachannel', (event) => {
      this.unreliableDataChannel = event.channel

      console.log('accepted unreliable data channel', event.channel.label)
      this.unreliableDataChannel.addEventListener('open', (event) => {
        console.log('unreliable data channel opened', event)
        if (this.shouldTrace()) {
          dataChannelSpan.resolve?.()
        }

        this.onDataChannelOpen(this)

        this.onEngineConnectionOpen(this)
        this.ready = true
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

    this.onConnectionStarted(this)
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

    this.onClose(this)
    this.ready = false
  }
}

export type EngineCommand = Models['WebSocketRequest_type']
type ModelTypes = Models['OkModelingCmdResponse_type']['type']

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
  sourceRangeMap: SourceRangeMap = {}
  outSequence = 1
  inSequence = 1
  engineConnection?: EngineConnection
  waitForReady: Promise<void> = new Promise(() => {})
  private resolveReady = () => {}

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
  constructor({
    setMediaStream,
    setIsStreamReady,
    width,
    height,
    token,
  }: {
    setMediaStream: (stream: MediaStream) => void
    setIsStreamReady: (isStreamReady: boolean) => void
    width: number
    height: number
    token?: string
  }) {
    this.waitForReady = new Promise((resolve) => {
      this.resolveReady = resolve
    })
    const url = `${VITE_KC_API_WS_MODELING_URL}?video_res_width=${width}&video_res_height=${height}`
    this.engineConnection = new EngineConnection({
      url,
      token,
      onEngineConnectionOpen: () => {
        this.resolveReady()
        setIsStreamReady(true)
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
            }
          }
        })
      },
      onNewTrack: ({ mediaStream }) => {
        console.log('received track', mediaStream)

        mediaStream.getVideoTracks()[0].addEventListener('mute', () => {
          console.log('peer is not sending video to us')
          this.engineConnection?.close()
          this.engineConnection?.connect()
        })

        setMediaStream(mediaStream)
      },
    })

    this.engineConnection?.connect()
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
        data: modelingResponse,
      }
      resolve({
        id,
        data: modelingResponse,
      })
    } else {
      this.artifactMap[id] = {
        type: 'result',
        data: modelingResponse,
      }
    }
  }
  tearDown() {
    this.engineConnection?.close()
  }
  startNewSession() {
    this.artifactMap = {}
    this.sourceRangeMap = {}
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
    // this.websocket?.close()
    // socket.off('command')
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
    if (!this.engineConnection?.isReady()) {
      console.log('socket not ready')
      return Promise.resolve()
    }
    if (command.type !== 'modeling_cmd_req') return Promise.resolve()
    const cmd = command.cmd
    if (
      cmd.type === 'camera_drag_move' &&
      this.engineConnection?.unreliableDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.unreliableDataChannel?.send(
        JSON.stringify(command)
      )
      return Promise.resolve()
    } else if (
      cmd.type === 'highlight_set_entity' &&
      this.engineConnection?.unreliableDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.unreliableDataChannel?.send(
        JSON.stringify(command)
      )
      return Promise.resolve()
    }
    console.log('sending command', command)
    // since it's not mouse drag or highlighting send over TCP and keep track of the command
    this.engineConnection?.send(command)
    return this.handlePendingCommand(command.cmd_id)
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
    this.sourceRangeMap[id] = range

    if (!this.engineConnection?.isReady()) {
      console.log('socket not ready')
      return Promise.resolve()
    }
    this.engineConnection?.send(command)
    return this.handlePendingCommand(id)
  }
  handlePendingCommand(id: string) {
    let resolve: (val: any) => void = () => {}
    const promise = new Promise((_resolve, reject) => {
      resolve = _resolve
    })
    this.artifactMap[id] = {
      type: 'pending',
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

    return this.sendModelingCommand({ id, range, command: commandStr })
  }
  commandResult(id: string): Promise<any> {
    const command = this.artifactMap[id]
    if (!command) {
      throw new Error('No command found')
    }
    if (command.type === 'result') {
      return command.data
    }
    return command.promise
  }
  async waitForAllCommands(): Promise<{
    artifactMap: ArtifactMap
    sourceRangeMap: SourceRangeMap
  }> {
    const pendingCommands = Object.values(this.artifactMap).filter(
      ({ type }) => type === 'pending'
    ) as PendingCommand[]
    const proms = pendingCommands.map(({ promise }) => promise)
    await Promise.all(proms)
    return {
      artifactMap: this.artifactMap,
      sourceRangeMap: this.sourceRangeMap,
    }
  }
}
