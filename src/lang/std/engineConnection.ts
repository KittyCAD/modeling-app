import { Program, SourceRange } from 'lang/wasm'
import { VITE_KC_API_WS_MODELING_URL } from 'env'
import { Models } from '@kittycad/lib'
import { exportSave } from 'lib/exportSave'
import { deferExecution, uuidv4 } from 'lib/utils'
import { Themes, getThemeColorForEngine, getOppositeTheme } from 'lib/theme'
import { DefaultPlanes } from 'wasm-lib/kcl/bindings/DefaultPlanes'
import {
  ArtifactMap,
  EngineCommand,
  OrderedCommand,
  ResponseMap,
  createArtifactMap,
} from 'lang/std/artifactMap'
import { useModelingContext } from 'hooks/useModelingContext'

// TODO(paultag): This ought to be tweakable.
const pingIntervalMs = 10000

function isHighlightSetEntity_type(
  data: any
): data is Models['HighlightSetEntity_type'] {
  return data.entity_id && data.sequence
}

type OkWebSocketResponseData = Models['OkWebSocketResponseData_type']

interface NewTrackArgs {
  conn: EngineConnection
  mediaStream: MediaStream
}

/** This looks funny, I know. This is needed because node and the browser
 * disagree as to the type. In a browser it's a number, but in node it's a
 * "Timeout".
 */
type IsomorphicTimeout = ReturnType<typeof setTimeout>

type ClientMetrics = Models['ClientMetrics_type']

interface WebRTCClientMetrics extends ClientMetrics {
  rtc_frame_height: number
  rtc_frame_width: number
  rtc_packets_lost: number
  rtc_pli_count: number
  rtc_pause_count: number
  rtc_total_pauses_duration_sec: number
}

type Value<T, U> = U extends undefined
  ? { type: T; value: U }
  : U extends void
  ? { type: T }
  : { type: T; value: U }

type State<T, U> = Value<T, U>

export enum EngineConnectionStateType {
  Fresh = 'fresh',
  Connecting = 'connecting',
  ConnectionEstablished = 'connection-established',
  Disconnecting = 'disconnecting',
  Disconnected = 'disconnected',
}

export enum DisconnectingType {
  Error = 'error',
  Timeout = 'timeout',
  Quit = 'quit',
  Pause = 'pause',
}

// Sorted by severity
export enum ConnectionError {
  Unset = 0,
  LongLoadingTime,

  ICENegotiate,
  DataChannelError,
  WebSocketError,
  LocalDescriptionInvalid,

  // These are more severe than protocol errors because they don't even allow
  // the program to do any protocol messages in the first place if they occur.
  MissingAuthToken,
  BadAuthToken,
  TooManyConnections,

  // An unknown error is the most severe because it has not been classified
  // or encountered before.
  Unknown,
}

export const CONNECTION_ERROR_TEXT: Record<ConnectionError, string> = {
  [ConnectionError.Unset]: '',
  [ConnectionError.LongLoadingTime]:
    'Loading is taking longer than expected...',
  [ConnectionError.ICENegotiate]: 'ICE negotiation failed.',
  [ConnectionError.DataChannelError]: 'The data channel signaled an error.',
  [ConnectionError.WebSocketError]: 'The websocket signaled an error.',
  [ConnectionError.LocalDescriptionInvalid]:
    'The local description is invalid.',
  [ConnectionError.MissingAuthToken]:
    'Your authorization token is missing; please login again.',
  [ConnectionError.BadAuthToken]:
    'Your authorization token is invalid; please login again.',
  [ConnectionError.TooManyConnections]: 'There are too many connections.',
  [ConnectionError.Unknown]:
    'An unexpected error occurred. Please report this to us.',
}

export interface ErrorType {
  // The error we've encountered.
  error: ConnectionError

  // Additional context.
  context?: any

  // We assign this in the state setter because we may have not failed at
  // a Connecting state, which we check for there.
  lastConnectingValue?: ConnectingValue
}

export type DisconnectingValue =
  | State<DisconnectingType.Error, ErrorType>
  | State<DisconnectingType.Timeout, void>
  | State<DisconnectingType.Quit, void>
  | State<DisconnectingType.Pause, void>

// These are ordered by the expected sequence.
export enum ConnectingType {
  WebSocketConnecting = 'websocket-connecting',
  WebSocketOpen = 'websocket-open',
  PeerConnectionCreated = 'peer-connection-created',
  ICEServersSet = 'ice-servers-set',
  SetLocalDescription = 'set-local-description',
  OfferedSdp = 'offered-sdp',
  ReceivedSdp = 'received-sdp',
  SetRemoteDescription = 'set-remote-description',
  WebRTCConnecting = 'webrtc-connecting',
  ICECandidateReceived = 'ice-candidate-received',
  TrackReceived = 'track-received',
  DataChannelRequested = 'data-channel-requested',
  DataChannelConnecting = 'data-channel-connecting',
  DataChannelEstablished = 'data-channel-established',
}

export enum ConnectingTypeGroup {
  WebSocket = 'WebSocket',
  ICE = 'ICE',
  WebRTC = 'WebRTC',
}

export const initialConnectingTypeGroupState: Record<
  ConnectingTypeGroup,
  [ConnectingType, boolean | undefined][]
> = {
  [ConnectingTypeGroup.WebSocket]: [
    [ConnectingType.WebSocketConnecting, undefined],
    [ConnectingType.WebSocketOpen, undefined],
  ],
  [ConnectingTypeGroup.ICE]: [
    [ConnectingType.PeerConnectionCreated, undefined],
    [ConnectingType.ICEServersSet, undefined],
    [ConnectingType.SetLocalDescription, undefined],
    [ConnectingType.OfferedSdp, undefined],
    [ConnectingType.ReceivedSdp, undefined],
    [ConnectingType.SetRemoteDescription, undefined],
    [ConnectingType.WebRTCConnecting, undefined],
    [ConnectingType.ICECandidateReceived, undefined],
  ],
  [ConnectingTypeGroup.WebRTC]: [
    [ConnectingType.TrackReceived, undefined],
    [ConnectingType.DataChannelRequested, undefined],
    [ConnectingType.DataChannelConnecting, undefined],
    [ConnectingType.DataChannelEstablished, undefined],
  ],
}

export type ConnectingValue =
  | State<ConnectingType.WebSocketConnecting, void>
  | State<ConnectingType.WebSocketOpen, void>
  | State<ConnectingType.PeerConnectionCreated, void>
  | State<ConnectingType.ICEServersSet, void>
  | State<ConnectingType.SetLocalDescription, void>
  | State<ConnectingType.OfferedSdp, void>
  | State<ConnectingType.ReceivedSdp, void>
  | State<ConnectingType.SetRemoteDescription, void>
  | State<ConnectingType.WebRTCConnecting, void>
  | State<ConnectingType.TrackReceived, void>
  | State<ConnectingType.ICECandidateReceived, void>
  | State<ConnectingType.DataChannelRequested, string>
  | State<ConnectingType.DataChannelConnecting, string>
  | State<ConnectingType.DataChannelEstablished, void>

export type EngineConnectionState =
  | State<EngineConnectionStateType.Fresh, void>
  | State<EngineConnectionStateType.Connecting, ConnectingValue>
  | State<EngineConnectionStateType.ConnectionEstablished, void>
  | State<EngineConnectionStateType.Disconnecting, DisconnectingValue>
  | State<EngineConnectionStateType.Disconnected, void>

export type PingPongState = 'OK' | 'TIMEOUT'

export enum EngineConnectionEvents {
  // Fires for each ping-pong success or failure.
  PingPongChanged = 'ping-pong-changed', // (state: PingPongState) => void

  // For now, this is only used by the NetworkHealthIndicator.
  // We can eventually use it for more, but one step at a time.
  ConnectionStateChanged = 'connection-state-changed', // (state: EngineConnectionState) => void

  // These are used for the EngineCommandManager and were created
  // before onConnectionStateChange existed.
  ConnectionStarted = 'connection-started', // (engineConnection: EngineConnection) => void
  Opened = 'opened', // (engineConnection: EngineConnection) => void
  Closed = 'closed', // (engineConnection: EngineConnection) => void
  NewTrack = 'new-track', // (track: NewTrackArgs) => void
}

// EngineConnection encapsulates the connection(s) to the Engine
// for the EngineCommandManager; namely, the underlying WebSocket
// and WebRTC connections.
class EngineConnection extends EventTarget {
  websocket?: WebSocket
  pc?: RTCPeerConnection
  unreliableDataChannel?: RTCDataChannel
  mediaStream?: MediaStream
  idleMode: boolean = false

  onIceCandidate = function (
    this: RTCPeerConnection,
    event: RTCPeerConnectionIceEvent
  ) {}
  onIceCandidateError = function (
    this: RTCPeerConnection,
    event: RTCPeerConnectionIceErrorEvent
  ) {}
  onConnectionStateChange = function (this: RTCPeerConnection, event: Event) {}
  onDataChannelOpen = function (this: RTCDataChannel, event: Event) {}
  onDataChannelClose = function (this: RTCDataChannel, event: Event) {}
  onDataChannelError = function (this: RTCDataChannel, event: Event) {}
  onDataChannelMessage = function (this: RTCDataChannel, event: MessageEvent) {}
  onDataChannel = function (
    this: RTCPeerConnection,
    event: RTCDataChannelEvent
  ) {}
  onTrack = function (this: RTCPeerConnection, event: RTCTrackEvent) {}
  onWebSocketOpen = function (event: Event) {}
  onWebSocketClose = function (event: Event) {}
  onWebSocketError = function (event: Event) {}
  onWebSocketMessage = function (event: MessageEvent) {}
  onNetworkStatusReady = () => {}

  private _state: EngineConnectionState = {
    type: EngineConnectionStateType.Fresh,
  }

  get state(): EngineConnectionState {
    return this._state
  }

  set state(next: EngineConnectionState) {
    console.log(`${JSON.stringify(this.state)} → ${JSON.stringify(next)}`)

    if (next.type === EngineConnectionStateType.Disconnecting) {
      const sub = next.value
      if (sub.type === DisconnectingType.Error) {
        // Record the last step we failed at.
        // (Check the current state that we're about to override that
        // it was a Connecting state.)
        if (this._state.type === EngineConnectionStateType.Connecting) {
          if (!sub.value) sub.value = { error: ConnectionError.Unknown }
          sub.value.lastConnectingValue = this._state.value
        }

        console.error(sub.value)
      }
    }
    this._state = next

    this.dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: this._state,
      })
    )
  }

  private failedConnTimeout: IsomorphicTimeout | null

  readonly url: string
  private readonly token?: string

  // TODO: actual type is ClientMetrics
  public webrtcStatsCollector?: () => Promise<WebRTCClientMetrics>
  private engineCommandManager: EngineCommandManager

  private pingPongSpan: { ping?: Date; pong?: Date }
  private pingIntervalId: ReturnType<typeof setInterval>

  constructor({
    engineCommandManager,
    url,
    token,
  }: {
    engineCommandManager: EngineCommandManager
    url: string
    token?: string
  }) {
    super()

    this.engineCommandManager = engineCommandManager
    this.url = url
    this.token = token
    this.failedConnTimeout = null

    this.pingPongSpan = { ping: undefined, pong: undefined }

    // Without an interval ping, our connection will timeout.
    // If this.idleMode is true we skip this logic so only reconnect
    // happens on mouse move
    this.pingIntervalId = setInterval(() => {
      if (this.idleMode) return

      switch (this.state.type as EngineConnectionStateType) {
        case EngineConnectionStateType.ConnectionEstablished:
          // If there was no reply to the last ping, report a timeout.
          if (this.pingPongSpan.ping && !this.pingPongSpan.pong) {
            this.dispatchEvent(
              new CustomEvent(EngineConnectionEvents.PingPongChanged, {
                detail: 'TIMEOUT',
              })
            )
            // Otherwise check the time between was >= pingIntervalMs,
            // and if it was, then it's bad network health.
          } else if (this.pingPongSpan.ping && this.pingPongSpan.pong) {
            if (
              Math.abs(
                this.pingPongSpan.pong.valueOf() -
                  this.pingPongSpan.ping.valueOf()
              ) >= pingIntervalMs
            ) {
              this.dispatchEvent(
                new CustomEvent(EngineConnectionEvents.PingPongChanged, {
                  detail: 'TIMEOUT',
                })
              )
            } else {
              this.dispatchEvent(
                new CustomEvent(EngineConnectionEvents.PingPongChanged, {
                  detail: 'OK',
                })
              )
            }
          }

          this.send({ type: 'ping' })
          this.pingPongSpan.ping = new Date()
          this.pingPongSpan.pong = undefined
          break
        case EngineConnectionStateType.Disconnecting:
        case EngineConnectionStateType.Disconnected:
          // Reconnect if we have disconnected.
          if (!this.isConnecting()) this.connect(true)
          break
        default:
          if (this.isConnecting()) break
          // Means we never could do an initial connection. Reconnect everything.
          if (!this.pingPongSpan.ping) this.connect(true)
          break
      }
    }, pingIntervalMs)

    this.connect()
  }

  isConnecting() {
    return this.state.type === EngineConnectionStateType.Connecting
  }

  isReady() {
    return this.state.type === EngineConnectionStateType.ConnectionEstablished
  }

  tearDown(opts?: { idleMode: boolean }) {
    this.idleMode = opts?.idleMode ?? false
    this.disconnectAll()
    clearInterval(this.pingIntervalId)

    this.pc?.removeEventListener('icecandidate', this.onIceCandidate)
    this.pc?.removeEventListener('icecandidateerror', this.onIceCandidateError)
    this.pc?.removeEventListener(
      'connectionstatechange',
      this.onConnectionStateChange
    )
    this.pc?.removeEventListener('track', this.onTrack)

    this.unreliableDataChannel?.removeEventListener(
      'open',
      this.onDataChannelOpen
    )
    this.unreliableDataChannel?.removeEventListener(
      'close',
      this.onDataChannelClose
    )
    this.unreliableDataChannel?.removeEventListener(
      'error',
      this.onDataChannelError
    )
    this.unreliableDataChannel?.removeEventListener(
      'message',
      this.onDataChannelMessage
    )
    this.pc?.removeEventListener('datachannel', this.onDataChannel)

    this.websocket?.removeEventListener('open', this.onWebSocketOpen)
    this.websocket?.removeEventListener('close', this.onWebSocketClose)
    this.websocket?.removeEventListener('error', this.onWebSocketError)
    this.websocket?.removeEventListener('message', this.onWebSocketMessage)

    window.removeEventListener(
      'use-network-status-ready',
      this.onNetworkStatusReady
    )

    this.state = opts?.idleMode
      ? {
          type: EngineConnectionStateType.Disconnecting,
          value: {
            type: DisconnectingType.Pause,
          },
        }
      : {
          type: EngineConnectionStateType.Disconnecting,
          value: {
            type: DisconnectingType.Quit,
          },
        }
  }

  /**
   * Attempts to connect to the Engine over a WebSocket, and
   * establish the WebRTC connections.
   *
   * This will attempt the full handshake, and retry if the connection
   * did not establish.
   */
  connect(reconnecting?: boolean) {
    if (this.isConnecting() || this.isReady()) {
      return
    }

    const createPeerConnection = () => {
      this.pc = new RTCPeerConnection({
        bundlePolicy: 'max-bundle',
      })

      // Other parts of the application expect pc to be initialized when firing.
      this.dispatchEvent(
        new CustomEvent(EngineConnectionEvents.ConnectionStarted, {
          detail: this,
        })
      )

      // Data channels MUST BE specified before SDP offers because requesting
      // them affects what our needs are!
      const DATACHANNEL_NAME_UMC = 'unreliable_modeling_cmds'
      this.pc.createDataChannel(DATACHANNEL_NAME_UMC)

      this.state = {
        type: EngineConnectionStateType.Connecting,
        value: {
          type: ConnectingType.DataChannelRequested,
          value: DATACHANNEL_NAME_UMC,
        },
      }

      this.onIceCandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate === null) {
          return
        }

        this.state = {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.ICECandidateReceived,
          },
        }

        // Request a candidate to use
        this.send({
          type: 'trickle_ice',
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid || undefined,
            sdpMLineIndex: event.candidate.sdpMLineIndex || undefined,
            usernameFragment: event.candidate.usernameFragment || undefined,
          },
        })
      }
      this.pc.addEventListener('icecandidate', this.onIceCandidate)

      this.onIceCandidateError = (_event: Event) => {
        const event = _event as RTCPeerConnectionIceErrorEvent
        console.warn(
          `ICE candidate returned an error: ${event.errorCode}: ${event.errorText} for ${event.url}`
        )
      }
      this.pc.addEventListener('icecandidateerror', this.onIceCandidateError)

      // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionstatechange_event
      // Event type: generic Event type...
      this.onConnectionStateChange = (event: any) => {
        console.log('connectionstatechange: ' + event.target?.connectionState)
        switch (event.target?.connectionState) {
          // From what I understand, only after have we done the ICE song and
          // dance is it safest to connect the video tracks / stream
          case 'connected':
            // Let the browser attach to the video stream now
            this.dispatchEvent(
              new CustomEvent(EngineConnectionEvents.NewTrack, {
                detail: { conn: this, mediaStream: this.mediaStream! },
              })
            )
            break
          case 'failed':
            this.disconnectAll()
            this.state = {
              type: EngineConnectionStateType.Disconnecting,
              value: {
                type: DisconnectingType.Error,
                value: {
                  error: ConnectionError.ICENegotiate,
                  context: event,
                },
              },
            }
            break
          default:
            break
        }
      }
      this.pc.addEventListener(
        'connectionstatechange',
        this.onConnectionStateChange
      )

      this.onTrack = (event) => {
        const mediaStream = event.streams[0]

        this.state = {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.TrackReceived,
          },
        }

        this.webrtcStatsCollector = (): Promise<WebRTCClientMetrics> => {
          return new Promise((resolve, reject) => {
            if (mediaStream.getVideoTracks().length !== 1) {
              reject(new Error('too many video tracks to report'))
              return
            }

            let videoTrack = mediaStream.getVideoTracks()[0]
            void this.pc?.getStats(videoTrack).then((videoTrackStats) => {
              let client_metrics: WebRTCClientMetrics = {
                rtc_frames_decoded: 0,
                rtc_frames_dropped: 0,
                rtc_frames_received: 0,
                rtc_frames_per_second: 0,
                rtc_freeze_count: 0,
                rtc_jitter_sec: 0.0,
                rtc_keyframes_decoded: 0,
                rtc_total_freezes_duration_sec: 0.0,
                rtc_frame_height: 0,
                rtc_frame_width: 0,
                rtc_packets_lost: 0,
                rtc_pli_count: 0,
                rtc_pause_count: 0,
                rtc_total_pauses_duration_sec: 0.0,
              }

              // TODO(paultag): Since we can technically have multiple WebRTC
              // video tracks (even if the Server doesn't at the moment), we
              // ought to send stats for every video track(?), and add the stream
              // ID into it.  This raises the cardinality of collected metrics
              // when/if we do, but for now, just report the one stream.

              videoTrackStats.forEach((videoTrackReport) => {
                if (videoTrackReport.type === 'inbound-rtp') {
                  client_metrics.rtc_frames_decoded =
                    videoTrackReport.framesDecoded || 0
                  client_metrics.rtc_frames_dropped =
                    videoTrackReport.framesDropped || 0
                  client_metrics.rtc_frames_received =
                    videoTrackReport.framesReceived || 0
                  client_metrics.rtc_frames_per_second =
                    videoTrackReport.framesPerSecond || 0
                  client_metrics.rtc_freeze_count =
                    videoTrackReport.freezeCount || 0
                  client_metrics.rtc_jitter_sec = videoTrackReport.jitter || 0.0
                  client_metrics.rtc_keyframes_decoded =
                    videoTrackReport.keyFramesDecoded || 0
                  client_metrics.rtc_total_freezes_duration_sec =
                    videoTrackReport.totalFreezesDuration || 0
                  client_metrics.rtc_frame_height =
                    videoTrackReport.frameHeight || 0
                  client_metrics.rtc_frame_width =
                    videoTrackReport.frameWidth || 0
                  client_metrics.rtc_packets_lost =
                    videoTrackReport.packetsLost || 0
                  client_metrics.rtc_pli_count = videoTrackReport.pliCount || 0
                } else if (videoTrackReport.type === 'transport') {
                  // videoTrackReport.bytesReceived,
                  // videoTrackReport.bytesSent,
                }
              })
              resolve(client_metrics)
            })
          })
        }

        // The app is eager to use the MediaStream; as soon as onNewTrack is
        // called, the following sequence happens:
        // EngineConnection.onNewTrack -> StoreState.setMediaStream ->
        // Stream.tsx reacts to mediaStream change, setting a video element.
        // We wait until connectionstatechange changes to "connected"
        // to pass it to the rest of the application.

        this.mediaStream = mediaStream
      }
      this.pc.addEventListener('track', this.onTrack)

      this.onDataChannel = (event) => {
        this.unreliableDataChannel = event.channel

        this.state = {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.DataChannelConnecting,
            value: event.channel.label,
          },
        }

        this.onDataChannelOpen = (event) => {
          this.state = {
            type: EngineConnectionStateType.Connecting,
            value: {
              type: ConnectingType.DataChannelEstablished,
            },
          }

          // Everything is now connected.
          this.state = { type: EngineConnectionStateType.ConnectionEstablished }

          this.engineCommandManager.inSequence = 1

          this.dispatchEvent(
            new CustomEvent(EngineConnectionEvents.Opened, { detail: this })
          )
        }
        this.unreliableDataChannel?.addEventListener(
          'open',
          this.onDataChannelOpen
        )

        this.onDataChannelClose = (event) => {
          this.disconnectAll()
          this.finalizeIfAllConnectionsClosed()
        }
        this.unreliableDataChannel?.addEventListener(
          'close',
          this.onDataChannelClose
        )

        this.onDataChannelError = (event) => {
          this.disconnectAll()

          this.state = {
            type: EngineConnectionStateType.Disconnecting,
            value: {
              type: DisconnectingType.Error,
              value: {
                error: ConnectionError.DataChannelError,
                context: event,
              },
            },
          }
        }
        this.unreliableDataChannel?.addEventListener(
          'error',
          this.onDataChannelError
        )

        this.onDataChannelMessage = (event) => {
          const result: UnreliableResponses = JSON.parse(event.data)
          Object.values(
            this.engineCommandManager.unreliableSubscriptions[result.type] || {}
          ).forEach(
            // TODO: There is only one response that uses the unreliable channel atm,
            // highlight_set_entity, if there are more it's likely they will all have the same
            // sequence logic, but I'm not sure if we use a single global sequence or a sequence
            // per unreliable subscription.
            (callback) => {
              if (
                result.type === 'highlight_set_entity' &&
                result?.data?.sequence &&
                result?.data.sequence > this.engineCommandManager.inSequence
              ) {
                this.engineCommandManager.inSequence = result.data.sequence
                callback(result)
              } else if (result.type !== 'highlight_set_entity') {
                callback(result)
              }
            }
          )
        }
        this.unreliableDataChannel.addEventListener(
          'message',
          this.onDataChannelMessage
        )
      }
      this.pc.addEventListener('datachannel', this.onDataChannel)
    }

    const createWebSocketConnection = () => {
      this.state = {
        type: EngineConnectionStateType.Connecting,
        value: {
          type: ConnectingType.WebSocketConnecting,
        },
      }

      this.websocket = new WebSocket(this.url, [])
      this.websocket.binaryType = 'arraybuffer'

      this.onWebSocketOpen = (event) => {
        this.state = {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.WebSocketOpen,
          },
        }

        // This is required for when KCMA is running stand-alone / within Tauri.
        // Otherwise when run in a browser, the token is sent implicitly via
        // the Cookie header.
        if (this.token) {
          this.send({
            type: 'headers',
            headers: { Authorization: `Bearer ${this.token}` },
          })
        }

        // Send an initial ping
        this.send({ type: 'ping' })
        this.pingPongSpan.ping = new Date()
      }
      this.websocket.addEventListener('open', this.onWebSocketOpen)

      this.onWebSocketClose = (event) => {
        this.disconnectAll()
        this.finalizeIfAllConnectionsClosed()
      }
      this.websocket.addEventListener('close', this.onWebSocketClose)

      this.onWebSocketError = (event) => {
        this.disconnectAll()

        this.state = {
          type: EngineConnectionStateType.Disconnecting,
          value: {
            type: DisconnectingType.Error,
            value: {
              error: ConnectionError.WebSocketError,
              context: event,
            },
          },
        }
      }
      this.websocket.addEventListener('error', this.onWebSocketError)

      this.onWebSocketMessage = (event) => {
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
            const artifactThatFailed =
              this.engineCommandManager.artifactMap[message.request_id]
            console.error(
              `Error in response to request ${message.request_id}:\n${errorsString}
  failed cmd type was ${artifactThatFailed?.type}`
            )
          } else {
            console.error(`Error from server:\n${errorsString}`)
          }

          const firstError = message?.errors[0]
          if (firstError.error_code === 'auth_token_invalid') {
            this.state = {
              type: EngineConnectionStateType.Disconnecting,
              value: {
                type: DisconnectingType.Error,
                value: {
                  error: ConnectionError.BadAuthToken,
                  context: firstError.message,
                },
              },
            }
            this.disconnectAll()
          }
          return
        }

        let resp = message.resp

        // If there's no body to the response, we can bail here.
        if (!resp || !resp.type) {
          return
        }

        switch (resp.type) {
          case 'pong':
            this.pingPongSpan.pong = new Date()
            break
          case 'ice_server_info':
            let ice_servers = resp.data?.ice_servers

            // Now that we have some ICE servers it makes sense
            // to start initializing the RTCPeerConnection. RTCPeerConnection
            // will begin the ICE process.
            createPeerConnection()

            this.state = {
              type: EngineConnectionStateType.Connecting,
              value: {
                type: ConnectingType.PeerConnectionCreated,
              },
            }

            // No ICE servers can be valid in a local dev. env.
            if (ice_servers?.length === 0) {
              console.warn('No ICE servers')
              this.pc?.setConfiguration({
                bundlePolicy: 'max-bundle',
              })
            } else {
              // When we set the Configuration, we want to always force
              // iceTransportPolicy to 'relay', since we know the topology
              // of the ICE/STUN/TUN server and the engine. We don't wish to
              // talk to the engine in any configuration /other/ than relay
              // from a infra POV.
              this.pc?.setConfiguration({
                bundlePolicy: 'max-bundle',
                iceServers: ice_servers,
                iceTransportPolicy: 'relay',
              })
            }

            this.state = {
              type: EngineConnectionStateType.Connecting,
              value: {
                type: ConnectingType.ICEServersSet,
              },
            }

            // We have an ICE Servers set now. We just setConfiguration, so let's
            // start adding things we care about to the PeerConnection and let
            // ICE negotiation happen in the background. Everything from here
            // until the end of this function is setup of our end of the
            // PeerConnection and waiting for events to fire our callbacks.

            // Add a transceiver to our SDP offer
            this.pc?.addTransceiver('video', {
              direction: 'recvonly',
            })

            // Create a session description offer based on our local environment
            // that we will send to the remote end. The remote will send back
            // what it supports via sdp_answer.
            this.pc
              ?.createOffer()
              .then((offer: RTCSessionDescriptionInit) => {
                this.state = {
                  type: EngineConnectionStateType.Connecting,
                  value: {
                    type: ConnectingType.SetLocalDescription,
                  },
                }
                return this.pc?.setLocalDescription(offer).then(() => {
                  this.send({
                    type: 'sdp_offer',
                    offer: offer as Models['RtcSessionDescription_type'],
                  })
                  this.state = {
                    type: EngineConnectionStateType.Connecting,
                    value: {
                      type: ConnectingType.OfferedSdp,
                    },
                  }
                })
              })
              .catch((err: Error) => {
                // The local description is invalid, so there's no point continuing.
                this.disconnectAll()
                this.state = {
                  type: EngineConnectionStateType.Disconnecting,
                  value: {
                    type: DisconnectingType.Error,
                    value: {
                      error: ConnectionError.LocalDescriptionInvalid,
                      context: err,
                    },
                  },
                }
              })
            break

          case 'sdp_answer':
            let answer = resp.data?.answer
            if (!answer || answer.type === 'unspecified') {
              return
            }

            this.state = {
              type: EngineConnectionStateType.Connecting,
              value: {
                type: ConnectingType.ReceivedSdp,
              },
            }

            // As soon as this is set, RTCPeerConnection tries to
            // establish a connection.
            // @ts-ignore
            // Have to ignore because dom.ts doesn't have the right type
            void this.pc?.setRemoteDescription(answer)

            this.state = {
              type: EngineConnectionStateType.Connecting,
              value: {
                type: ConnectingType.SetRemoteDescription,
              },
            }

            this.state = {
              type: EngineConnectionStateType.Connecting,
              value: {
                type: ConnectingType.WebRTCConnecting,
              },
            }
            break

          case 'trickle_ice':
            let candidate = resp.data?.candidate
            void this.pc?.addIceCandidate(candidate as RTCIceCandidateInit)
            break

          case 'metrics_request':
            if (this.webrtcStatsCollector === undefined) {
              // TODO: Error message here?
              return
            }
            void this.webrtcStatsCollector().then((client_metrics) => {
              this.send({
                type: 'metrics_response',
                metrics: client_metrics,
              })
            })
            break
        }
      }
      this.websocket.addEventListener('message', this.onWebSocketMessage)
    }

    if (reconnecting) {
      createWebSocketConnection()
    } else {
      this.onNetworkStatusReady = () => {
        createWebSocketConnection()
      }
      window.addEventListener(
        'use-network-status-ready',
        this.onNetworkStatusReady
      )
    }
  }
  // Do not change this back to an object or any, we should only be sending the
  // WebSocketRequest type!
  unreliableSend(message: Models['WebSocketRequest_type']) {
    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.unreliableDataChannel?.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }
  // Do not change this back to an object or any, we should only be sending the
  // WebSocketRequest type!
  send(message: Models['WebSocketRequest_type']) {
    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.websocket?.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }
  disconnectAll() {
    this.websocket?.close()
    this.unreliableDataChannel?.close()
    this.pc?.close()

    this.webrtcStatsCollector = undefined
  }
  finalizeIfAllConnectionsClosed() {
    const allClosed =
      this.websocket?.readyState === 3 &&
      this.pc?.connectionState === 'closed' &&
      this.unreliableDataChannel?.readyState === 'closed'
    if (allClosed) {
      // Do not notify the rest of the program that we have cut off anything.
      this.state = { type: EngineConnectionStateType.Disconnected }
    }
  }
}

type ModelTypes = Models['OkModelingCmdResponse_type']['type']

type UnreliableResponses = Extract<
  Models['OkModelingCmdResponse_type'],
  { type: 'highlight_set_entity' | 'camera_drag_move' }
>
export interface UnreliableSubscription<T extends UnreliableResponses['type']> {
  event: T
  callback: (data: Extract<UnreliableResponses, { type: T }>) => void
}

// TODO: Should eventually be replaced with native EventTarget event system,
// as it manages events in a more familiar way to other developers.
export interface Subscription<T extends ModelTypes> {
  event: T
  callback: (
    data: Extract<Models['OkModelingCmdResponse_type'], { type: T }>
  ) => void
}

export type CommandLog =
  | {
      type: 'send-modeling'
      data: EngineCommand
    }
  | {
      type: 'send-scene'
      data: EngineCommand
    }
  | {
      type: 'receive-reliable'
      data: OkWebSocketResponseData
      id: string
      cmd_type?: string
    }
  | {
      type: 'execution-done'
      data: null
    }

export enum EngineCommandManagerEvents {
  EngineAvailable = 'engine-available',
}

/**
 * The EngineCommandManager is the main interface to the Engine for Modeling App.
 *
 * It is responsible for sending commands to the Engine, and managing the state
 * of those commands. It also sets up and tears down the connection to the Engine
 * through the {@link EngineConnection} class.
 *
 * It also maintains an {@link artifactMap} that keeps track of the state of each
 * command, and the artifacts that have been generated by those commands.
 */

interface PendingMessage {
  command: EngineCommand
  range: SourceRange
  idToRangeMap: { [key: string]: SourceRange }
  resolve: (data: [Models['WebSocketResponse_type']]) => void
  reject: (reason: string) => void
  promise: Promise<[Models['WebSocketResponse_type']]>
}
export class EngineCommandManager extends EventTarget {
  /**
   * The artifactMap is a client-side representation of the commands that have been sent
   * to the server-side geometry engine, and the state of their resulting artifacts.
   *
   * It is used to keep track of the state of each command, which can fail, succeed, or be
   * pending.
   *
   * It is also used to keep track of our client's understanding of what is in the engine scene
   * so that we can map to and from KCL code. Each artifact maintains a source range to the part
   * of the KCL code that generated it.
   */
  artifactMap: ArtifactMap = {}
  /**
   * The pendingCommands object is a map of the commands that have been sent to the engine that are still waiting on a reply
   */
  pendingCommands: {
    [commandId: string]: PendingMessage
  } = {}
  /**
   * The orderedCommands array of all the the commands sent to the engine, un-folded from batches, and made into one long
   * list of the individual commands, this is used to process all the commands into the artifactMap
   */
  orderedCommands: Array<OrderedCommand> = []
  /**
   * A map of the responses to the @this.orderedCommands, when processing the commands into the artifactMap, this response map allow
   * us to look up the response by command id
   */
  responseMap: ResponseMap = {}
  /**
   * The client-side representation of the scene command artifacts that have been sent to the server;
   * that is, the *non-modeling* commands and corresponding artifacts.
   *
   * For modeling commands, see {@link artifactMap}.
   */
  sceneCommandArtifacts: ArtifactMap = {}
  /**
   * A counter that is incremented with each command sent over the *unreliable* channel to the engine.
   * This is compared to the latest received {@link inSequence} number to determine if we should ignore
   * any out-of-order late responses in the unreliable channel.
   */
  outSequence = 1
  /**
   * The latest sequence number received from the engine over the *unreliable* channel.
   * This is compared to the {@link outSequence} number to determine if we should ignore
   * any out-of-order late responses in the unreliable channel.
   */
  inSequence = 1
  pool?: string
  engineConnection?: EngineConnection
  defaultPlanes: DefaultPlanes | null = null
  commandLogs: CommandLog[] = []
  pendingExport?: {
    resolve: (a: null) => void
    reject: (reason: any) => void
  }
  _commandLogCallBack: (command: CommandLog[]) => void = () => {}
  private resolveReady = () => {}
  /** Folks should realize that wait for ready does not get called _everytime_
   *  the connection resets and restarts, it only gets called the first time.
   *
   *  Be careful what you put here.
   */
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

  constructor(pool?: string) {
    super()

    this.engineConnection = undefined
    this.pool = pool
  }

  private _camControlsCameraChange = () => {}
  set camControlsCameraChange(cb: () => void) {
    this._camControlsCameraChange = cb
  }

  private getAst: () => Program = () =>
    ({ start: 0, end: 0, body: [], nonCodeMeta: {} } as any)
  set getAstCb(cb: () => Program) {
    this.getAst = cb
  }
  private makeDefaultPlanes: () => Promise<DefaultPlanes> | null = () => null
  private modifyGrid: (hidden: boolean) => Promise<void> | null = () => null

  private onEngineConnectionOpened = () => {}
  private onEngineConnectionClosed = () => {}
  private onEngineConnectionStarted = ({ detail: engineConnection }: any) => {}
  private onEngineConnectionNewTrack = ({
    detail,
  }: CustomEvent<NewTrackArgs>) => {}
  modelingSend: ReturnType<typeof useModelingContext>['send'] =
    (() => {}) as any

  start({
    restart,
    setMediaStream,
    setIsStreamReady,
    width,
    height,
    executeCode,
    token,
    makeDefaultPlanes,
    modifyGrid,
    settings = {
      theme: Themes.Dark,
      highlightEdges: true,
      enableSSAO: true,
      showScaleGrid: false,
    },
  }: {
    restart?: boolean
    setMediaStream: (stream: MediaStream) => void
    setIsStreamReady: (isStreamReady: boolean) => void
    width: number
    height: number
    executeCode: () => void
    token?: string
    makeDefaultPlanes: () => Promise<DefaultPlanes>
    modifyGrid: (hidden: boolean) => Promise<void>
    settings?: {
      theme: Themes
      highlightEdges: boolean
      enableSSAO: boolean
      showScaleGrid: boolean
    }
  }) {
    this.makeDefaultPlanes = makeDefaultPlanes
    this.modifyGrid = modifyGrid
    if (width === 0 || height === 0) {
      return
    }

    // If we already have an engine connection, just need to resize the stream.
    if (this.engineConnection) {
      this.handleResize({
        streamWidth: width,
        streamHeight: height,
      })
      return
    }

    const additionalSettings = settings.enableSSAO ? '&post_effect=ssao' : ''
    const pool = this.pool === undefined ? '' : `&pool=${this.pool}`
    const url = `${VITE_KC_API_WS_MODELING_URL}?video_res_width=${width}&video_res_height=${height}${additionalSettings}${pool}`
    this.engineConnection = new EngineConnection({
      engineCommandManager: this,
      url,
      token,
    })

    this.dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.EngineAvailable, {
        detail: this.engineConnection,
      })
    )

    this.onEngineConnectionOpened = () => {
      // Set the stream background color
      // This takes RGBA values from 0-1
      // So we convert from the conventional 0-255 found in Figma

      void this.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'set_background_color',
          color: getThemeColorForEngine(settings.theme),
        },
      })

      // Sets the default line colors
      const opposingTheme = getOppositeTheme(settings.theme)
      this.sendSceneCommand({
        cmd_id: uuidv4(),
        type: 'modeling_cmd_req',
        cmd: {
          type: 'set_default_system_properties',
          color: getThemeColorForEngine(opposingTheme),
        },
      })

      // Set the edge lines visibility
      this.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'edge_lines_visible' as any, // TODO: update kittycad.ts to use the correct type
          hidden: !settings.highlightEdges,
        },
      })

      this._camControlsCameraChange()
      this.sendSceneCommand({
        // CameraControls subscribes to default_camera_get_settings response events
        // firing this at connection ensure the camera's are synced initially
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_get_settings',
        },
      })
      // We want modify the grid first because we don't want it to flash.
      // Ideally these would already be default hidden in engine (TODO do
      // that) https://github.com/KittyCAD/engine/issues/2282
      this.modifyGrid(!settings.showScaleGrid)?.then(async () => {
        await this.initPlanes()
        this.resolveReady()
        setIsStreamReady(true)
        await executeCode()
      })
    }
    this.engineConnection.addEventListener(
      EngineConnectionEvents.Opened,
      this.onEngineConnectionOpened
    )

    this.onEngineConnectionClosed = () => {
      setIsStreamReady(false)
    }
    this.engineConnection.addEventListener(
      EngineConnectionEvents.Closed,
      this.onEngineConnectionClosed
    )

    this.onEngineConnectionStarted = ({ detail: engineConnection }: any) => {
      engineConnection?.pc?.addEventListener(
        'datachannel',
        (event: RTCDataChannelEvent) => {
          let unreliableDataChannel = event.channel

          unreliableDataChannel.addEventListener(
            'message',
            (event: MessageEvent) => {
              const result: UnreliableResponses = JSON.parse(event.data)
              Object.values(
                this.unreliableSubscriptions[result.type] || {}
              ).forEach(
                // TODO: There is only one response that uses the unreliable channel atm,
                // highlight_set_entity, if there are more it's likely they will all have the same
                // sequence logic, but I'm not sure if we use a single global sequence or a sequence
                // per unreliable subscription.
                (callback) => {
                  let data = result?.data
                  if (isHighlightSetEntity_type(data)) {
                    if (
                      data.sequence !== undefined &&
                      data.sequence > this.inSequence
                    ) {
                      this.inSequence = data.sequence
                      callback(result)
                    }
                  }
                }
              )
            }
          )
        }
      )

      // When the EngineConnection starts a connection, we want to register
      // callbacks into the WebSocket/PeerConnection.
      engineConnection.websocket?.addEventListener('message', ((
        event: MessageEvent
      ) => {
        if (event.data instanceof ArrayBuffer) {
          // If the data is an ArrayBuffer, it's  the result of an export command,
          // because in all other cases we send JSON strings. But in the case of
          // export we send a binary blob.
          // Pass this to our export function.
          exportSave(event.data).then(() => {
            this.pendingExport?.resolve(null)
          }, this.pendingExport?.reject)
          return
        }

        const message: Models['WebSocketResponse_type'] = JSON.parse(event.data)
        const pending = this.pendingCommands[message.request_id || '']

        if (pending && !message.success) {
          // handle bad case
          pending.reject(`engine error: ${JSON.stringify(message.errors)}`)
          delete this.pendingCommands[message.request_id || '']
        }
        if (
          !(
            pending &&
            message.success &&
            (message.resp.type === 'modeling' ||
              message.resp.type === 'modeling_batch')
          )
        )
          return

        if (
          message.resp.type === 'modeling' &&
          pending.command.type === 'modeling_cmd_req' &&
          message.request_id
        ) {
          this.addCommandLog({
            type: 'receive-reliable',
            data: message.resp,
            id: message?.request_id || '',
            cmd_type: pending?.command?.cmd?.type,
          })

          const modelingResponse = message.resp.data.modeling_response

          Object.values(
            this.subscriptions[modelingResponse.type] || {}
          ).forEach((callback) => callback(modelingResponse))

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
                  type: 'receive-reliable',
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

        pending.resolve([message])
        delete this.pendingCommands[message.request_id || '']
      }) as EventListener)

      this.onEngineConnectionNewTrack = ({
        detail: { mediaStream },
      }: CustomEvent<NewTrackArgs>) => {
        mediaStream.getVideoTracks()[0].addEventListener('mute', () => {
          console.error(
            'video track mute: check webrtc internals -> inbound rtp'
          )
        })

        setMediaStream(mediaStream)
      }
      this.engineConnection?.addEventListener(
        EngineConnectionEvents.NewTrack,
        this.onEngineConnectionNewTrack as EventListener
      )

      this.engineConnection?.connect()
    }
    this.engineConnection.addEventListener(
      EngineConnectionEvents.ConnectionStarted,
      this.onEngineConnectionStarted
    )
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

  tearDown(opts?: { idleMode: boolean }) {
    if (this.engineConnection) {
      this.engineConnection.removeEventListener(
        EngineConnectionEvents.Opened,
        this.onEngineConnectionOpened
      )
      this.engineConnection.removeEventListener(
        EngineConnectionEvents.Closed,
        this.onEngineConnectionClosed
      )
      this.engineConnection.removeEventListener(
        EngineConnectionEvents.ConnectionStarted,
        this.onEngineConnectionStarted
      )
      this.engineConnection.removeEventListener(
        EngineConnectionEvents.NewTrack,
        this.onEngineConnectionNewTrack as EventListener
      )

      this.engineConnection?.tearDown(opts)
      this.engineConnection = undefined

      // Our window.tearDown assignment causes this case to happen which is
      // only really for tests.
      // @ts-ignore
    } else if (this.engineCommandManager?.engineConnection) {
      // @ts-ignore
      this.engineCommandManager?.engineConnection?.tearDown(opts)
    }
  }
  async startNewSession() {
    this.orderedCommands = []
    this.responseMap = {}
    await this.initPlanes()
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
  // We make this a separate function so we can call it from wasm.
  clearDefaultPlanes() {
    this.defaultPlanes = null
  }
  async wasmGetDefaultPlanes(): Promise<string> {
    if (this.defaultPlanes === null) {
      await this.initPlanes()
    }
    return JSON.stringify(this.defaultPlanes)
  }
  endSession() {
    const deleteCmd: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'scene_clear_all',
      },
    }
    this.clearDefaultPlanes()
    this.engineConnection?.send(deleteCmd)
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
  sendSceneCommand(
    command: EngineCommand,
    forceWebsocket = false
  ): Promise<Models['WebSocketResponse_type'] | null> {
    if (this.engineConnection === undefined) {
      return Promise.resolve(null)
    }

    if (!this.engineConnection?.isReady()) {
      return Promise.resolve(null)
    }

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
        type: 'send-scene',
        data: command,
      })
    }

    if (command.type === 'modeling_cmd_batch_req') {
      this.engineConnection?.send(command)
      // TODO - handlePendingCommands does not handle batch commands
      // return this.handlePendingCommand(command.requests[0].cmd_id, command.cmd)
      return Promise.resolve(null)
    }
    if (command.type !== 'modeling_cmd_req') return Promise.resolve(null)
    const cmd = command.cmd
    if (
      (cmd.type === 'camera_drag_move' ||
        cmd.type === 'handle_mouse_drag_move' ||
        cmd.type === 'default_camera_zoom' ||
        cmd.type === ('default_camera_perspective_settings' as any)) &&
      this.engineConnection?.unreliableDataChannel &&
      !forceWebsocket
    ) {
      ;(cmd as any).sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.unreliableSend(command)
      return Promise.resolve(null)
    } else if (
      cmd.type === 'highlight_set_entity' &&
      this.engineConnection?.unreliableDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.unreliableSend(command)
      return Promise.resolve(null)
    } else if (
      cmd.type === 'mouse_move' &&
      this.engineConnection.unreliableDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.unreliableSend(command)
      return Promise.resolve(null)
    } else if (cmd.type === 'export') {
      const promise = new Promise<null>((resolve, reject) => {
        this.pendingExport = { resolve, reject }
      })
      this.engineConnection?.send(command)
      return promise
    }
    if (
      command.cmd.type === 'default_camera_look_at' ||
      command.cmd.type === ('default_camera_perspective_settings' as any)
    ) {
      ;(cmd as any).sequence = this.outSequence++
    }
    // since it's not mouse drag or highlighting send over TCP and keep track of the command
    return this.sendCommand(command.cmd_id, {
      command,
      idToRangeMap: {},
      range: [0, 0],
    }).then(([a]) => a)
  }
  /**
   * A wrapper around the sendCommand where all inputs are JSON strings
   */
  async sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<string | void> {
    if (this.engineConnection === undefined) {
      return Promise.resolve()
    }
    if (!this.engineConnection?.isReady()) {
      return Promise.resolve()
    }
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

    const resp = await this.sendCommand(id, {
      command,
      range,
      idToRangeMap,
    })
    return JSON.stringify(resp[0])
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
    }
  ): Promise<[Models['WebSocketResponse_type']]> {
    const { promise, resolve, reject } = promiseFactory<any>()
    this.pendingCommands[id] = {
      resolve,
      reject,
      promise,
      command: message.command,
      range: message.range,
      idToRangeMap: message.idToRangeMap,
    }
    if (message.command.type === 'modeling_cmd_req') {
      this.orderedCommands.push({
        command: message.command,
        range: message.range,
      })
    } else if (message.command.type === 'modeling_cmd_batch_req') {
      message.command.requests.forEach((req) => {
        const cmd: EngineCommand = {
          type: 'modeling_cmd_req',
          cmd_id: req.cmd_id,
          cmd: req.cmd,
        }
        this.orderedCommands.push({
          command: cmd,
          range: message.idToRangeMap[req.cmd_id || ''],
        })
      })
    }
    this.engineConnection?.send(message.command)
    return promise
  }

  deferredArtifactPopulated = deferExecution((a?: null) => {
    this.modelingSend({ type: 'Artifact graph populated' })
  }, 200)
  deferredArtifactEmptied = deferExecution((a?: null) => {
    this.modelingSend({ type: 'Artifact graph emptied' })
  }, 200)

  /**
   * When an execution takes place we want to wait until we've got replies for all of the commands
   * When this is done when we build the artifact map synchronously.
   */
  async waitForAllCommands() {
    await Promise.all(Object.values(this.pendingCommands).map((a) => a.promise))
    this.artifactMap = createArtifactMap({
      orderedCommands: this.orderedCommands,
      responseMap: this.responseMap,
      ast: this.getAst(),
    })
    if (Object.values(this.artifactMap).length) {
      this.deferredArtifactEmptied(null)
    } else {
      this.deferredArtifactPopulated(null)
    }
  }
  private async initPlanes() {
    if (this.planesInitialized()) return
    const planes = await this.makeDefaultPlanes()
    this.defaultPlanes = planes
  }
  planesInitialized(): boolean {
    return (
      !!this.defaultPlanes &&
      this.defaultPlanes.xy !== '' &&
      this.defaultPlanes.yz !== '' &&
      this.defaultPlanes.xz !== ''
    )
  }

  async setPlaneHidden(id: string, hidden: boolean) {
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

  /**
   * Set the visibility of the scale grid in the engine scene.
   * @param visible - whether to show or hide the scale grid
   */
  setScaleGridVisibility(visible: boolean) {
    this.modifyGrid(!visible)
  }

  // Some "objects" have the same source range, such as sketch_mode_start and start_path.
  // So when passing a range, we need to also specify the command type
  mapRangeToObjectId(
    range: SourceRange,
    commandTypeToTarget: string
  ): string | undefined {
    const values = Object.entries(this.artifactMap)
    for (const [id, data] of values) {
      // // Our range selection seems to just select the cursor position, so either
      // // of these can be right...
      if (
        (data.range[0] === range[0] || data.range[1] === range[1]) &&
        data.type === commandTypeToTarget
      )
        return id
    }
    return undefined
  }
}

function promiseFactory<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {}
  let reject: (value: T | PromiseLike<T>) => void = () => {}
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}
