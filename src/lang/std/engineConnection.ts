import { defaultSourceRange, SourceRange } from 'lang/wasm'
import { VITE_KC_API_WS_MODELING_URL, VITE_KC_DEV_TOKEN } from 'env'
import { Models } from '@kittycad/lib'
import { uuidv4, binaryToUuid } from 'lib/utils'
import { BSON } from 'bson'
import {
  Themes,
  getThemeColorForEngine,
  getOppositeTheme,
  darkModeMatcher,
} from 'lib/theme'
import { EngineCommand, ResponseMap } from 'lang/std/artifactGraph'
import { useModelingContext } from 'hooks/useModelingContext'
import { SettingsViaQueryString } from 'lib/settings/settingsTypes'
import { EXECUTE_AST_INTERRUPT_ERROR_MESSAGE } from 'lib/constants'
import { KclManager } from 'lang/KclSingleton'
import { reportRejection } from 'lib/trap'
import { markOnce } from 'lib/performance'
import { MachineManager } from 'components/MachineManagerProvider'

// TODO(paultag): This ought to be tweakable.
const pingIntervalMs = 5_000

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

function toRTCSessionDescriptionInit(
  desc: Models['RtcSessionDescription_type']
): RTCSessionDescriptionInit | undefined {
  if (desc.type === 'unspecified') {
    console.error('Invalid SDP answer: type is "unspecified".')
    return undefined
  }
  return {
    sdp: desc.sdp,
    // Force the type to be one of the valid RTCSdpType values
    type: desc.type as RTCSdpType,
  }
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
  promise?: Promise<void>
  sdpAnswer?: RTCSessionDescriptionInit
  triggeredStart = false

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

  readonly url: string
  private readonly token?: string

  // TODO: actual type is ClientMetrics
  public webrtcStatsCollector?: () => Promise<WebRTCClientMetrics>
  private engineCommandManager: EngineCommandManager

  private pingPongSpan: { ping?: Date; pong?: Date }
  private pingIntervalId: ReturnType<typeof setInterval> = setInterval(() => {},
  60_000)
  isUsingConnectionLite: boolean = false

  constructor({
    engineCommandManager,
    url,
    token,
    callbackOnEngineLiteConnect,
  }: {
    engineCommandManager: EngineCommandManager
    url: string
    token?: string
    callbackOnEngineLiteConnect?: () => void
  }) {
    markOnce('code/startInitialEngineConnect')
    super()

    this.engineCommandManager = engineCommandManager
    this.url = url
    this.token = token
    this.pingPongSpan = { ping: undefined, pong: undefined }

    if (callbackOnEngineLiteConnect) {
      this.connectLite(callbackOnEngineLiteConnect)
      this.isUsingConnectionLite = true
      return
    }

    // Without an interval ping, our connection will timeout.
    // If this.idleMode is true we skip this logic so only reconnect
    // happens on mouse move
    this.pingIntervalId = setInterval(() => {
      if (this.idleMode) return

      switch (this.state.type as EngineConnectionStateType) {
        case EngineConnectionStateType.ConnectionEstablished:
          // If there was no reply to the last ping, report a timeout and
          // teardown the connection.
          if (this.pingPongSpan.ping && !this.pingPongSpan.pong) {
            this.dispatchEvent(
              new CustomEvent(EngineConnectionEvents.PingPongChanged, {
                detail: 'TIMEOUT',
              })
            )
            this.state = {
              type: EngineConnectionStateType.Disconnecting,
              value: {
                type: DisconnectingType.Timeout,
              },
            }
            this.disconnectAll()

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
          // We will do reconnection elsewhere, because we basically need
          // to destroy this EngineConnection, and this setInterval loop
          // lives inside it. (lee) I might change this in the future so it's
          // outside this class.
          break
        default:
          if (this.isConnecting()) break
          // Means we never could do an initial connection. Reconnect everything.
          if (!this.pingPongSpan.ping) this.connect().catch(reportRejection)
          break
      }
    }, pingIntervalMs)

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.connect()
  }

  // SHOULD ONLY BE USED FOR VITESTS
  connectLite(callback: () => void) {
    const url = `${VITE_KC_API_WS_MODELING_URL}?video_res_width=${256}&video_res_height=${256}`

    this.websocket = new WebSocket(url, [])
    this.websocket.binaryType = 'arraybuffer'

    this.send = (a) => {
      if (!this.websocket) return
      this.websocket.send(JSON.stringify(a))
    }
    this.onWebSocketOpen = (event) => {
      this.send({
        type: 'headers',
        headers: {
          Authorization: `Bearer ${VITE_KC_DEV_TOKEN}`,
        },
      })
    }
    this.tearDown = () => {}
    this.websocket.addEventListener('open', this.onWebSocketOpen)

    this.websocket?.addEventListener('message', ((event: MessageEvent) => {
      const message: Models['WebSocketResponse_type'] = JSON.parse(event.data)
      const pending =
        this.engineCommandManager.pendingCommands[message.request_id || '']
      if (!('resp' in message)) return

      let resp = message.resp

      // If there's no body to the response, we can bail here.
      if (!resp || !resp.type) {
        return
      }

      switch (resp.type) {
        case 'pong':
          break

        // Only fires on successful authentication.
        case 'ice_server_info':
          callback()
          return
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
        this.engineCommandManager.responseMap[message.request_id] = message.resp
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
              this.engineCommandManager.responseMap[commandId] = {
                type: 'modeling',
                data: {
                  modeling_response: response.response,
                },
              }
          }
        )
      }

      pending.resolve([message])
      delete this.engineCommandManager.pendingCommands[message.request_id || '']
    }) as EventListener)
  }

  isConnecting() {
    return this.state.type === EngineConnectionStateType.Connecting
  }

  isReady() {
    return this.state.type === EngineConnectionStateType.ConnectionEstablished
  }

  tearDown(opts?: { idleMode: boolean }) {
    this.idleMode = opts?.idleMode ?? false
    clearInterval(this.pingIntervalId)

    if (opts?.idleMode) {
      this.state = {
        type: EngineConnectionStateType.Disconnecting,
        value: {
          type: DisconnectingType.Pause,
        },
      }
    }
    // Pass the state along
    if (this.state.type === EngineConnectionStateType.Disconnecting) return
    if (this.state.type === EngineConnectionStateType.Disconnected) return

    // Otherwise it's by default a "quit"
    this.state = {
      type: EngineConnectionStateType.Disconnecting,
      value: {
        type: DisconnectingType.Quit,
      },
    }

    this.disconnectAll()
  }

  initiateConnectionExclusive(): boolean {
    // Only run if:
    // - A peer connection exists,
    // - ICE gathering is complete,
    // - We have an SDP answer,
    // - And we haven’t already triggered this connection.
    if (!this.pc || this.triggeredStart || !this.sdpAnswer) {
      return false
    }
    this.triggeredStart = true

    // Transition to the connecting state
    this.state = {
      type: EngineConnectionStateType.Connecting,
      value: { type: ConnectingType.WebRTCConnecting },
    }

    // Attempt to set the remote description to initiate connection
    this.pc
      .setRemoteDescription(this.sdpAnswer)
      .then(() => {
        // Update state once the remote description has been set
        this.state = {
          type: EngineConnectionStateType.Connecting,
          value: { type: ConnectingType.SetRemoteDescription },
        }
      })
      .catch((error: Error) => {
        console.error('Failed to set remote description:', error)
        this.state = {
          type: EngineConnectionStateType.Disconnecting,
          value: {
            type: DisconnectingType.Error,
            value: {
              error: ConnectionError.LocalDescriptionInvalid,
              context: error,
            },
          },
        }
        this.disconnectAll()
      })
    return true
  }

  /**
   * Attempts to connect to the Engine over a WebSocket, and
   * establish the WebRTC connections.
   *
   * This will attempt the full handshake, and retry if the connection
   * did not establish.
   */
  connect(reconnecting?: boolean): Promise<void> {
    const that = this
    return new Promise((resolve) => {
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
        this.pc?.createDataChannel?.(DATACHANNEL_NAME_UMC)

        this.state = {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.DataChannelRequested,
            value: DATACHANNEL_NAME_UMC,
          },
        }

        this.onIceCandidate = (event: RTCPeerConnectionIceEvent) => {
          console.log('icecandidate', event.candidate)

          // This is null when the ICE gathering state is done.
          // Windows ONLY uses this to signal it's done!
          if (event.candidate === null) {
            that.initiateConnectionExclusive()
            return
          }

          this.state = {
            type: EngineConnectionStateType.Connecting,
            value: {
              type: ConnectingType.ICECandidateReceived,
            },
          }

          this.send({
            type: 'trickle_ice',
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid || undefined,
              sdpMLineIndex: event.candidate.sdpMLineIndex || undefined,
              usernameFragment: event.candidate.usernameFragment || undefined,
            },
          })

          // Sometimes the remote end doesn't report the end of candidates.
          // They have 3 seconds to.
          setTimeout(() => {
            if (that.initiateConnectionExclusive()) {
              console.warn('connected after 3 second delay')
            }
          }, 3000)
        }
        this.pc?.addEventListener?.('icecandidate', this.onIceCandidate)
        this.pc?.addEventListener?.(
          'icegatheringstatechange',
          function (_event) {
            console.log('icegatheringstatechange', this.iceGatheringState)

            if (this.iceGatheringState !== 'complete') return
            that.initiateConnectionExclusive()
          }
        )

        this.pc?.addEventListener?.(
          'iceconnectionstatechange',
          function (_event) {
            console.log('iceconnectionstatechange', this.iceConnectionState)
            console.log('iceconnectionstatechange', this.iceGatheringState)
          }
        )
        this.pc?.addEventListener?.('negotiationneeded', function (_event) {
          console.log('negotiationneeded', this.iceConnectionState)
          console.log('negotiationneeded', this.iceGatheringState)
        })
        this.pc?.addEventListener?.('signalingstatechange', function (event) {
          console.log('signalingstatechange', this.signalingState)
        })

        this.onIceCandidateError = (_event: Event) => {
          const event = _event as RTCPeerConnectionIceErrorEvent
          console.warn(
            `ICE candidate returned an error: ${event.errorCode}: ${event.errorText} for ${event.url}`
          )
        }
        this.pc?.addEventListener?.(
          'icecandidateerror',
          this.onIceCandidateError
        )

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
            case 'connecting':
              break
            case 'disconnected':
            case 'failed':
              this.pc?.removeEventListener('icecandidate', this.onIceCandidate)
              this.pc?.removeEventListener(
                'icecandidateerror',
                this.onIceCandidateError
              )
              this.pc?.removeEventListener(
                'connectionstatechange',
                this.onConnectionStateChange
              )
              this.pc?.removeEventListener('track', this.onTrack)

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
              this.disconnectAll()
              break
            default:
              break
          }
        }
        this.pc?.addEventListener?.(
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
                    client_metrics.rtc_jitter_sec =
                      videoTrackReport.jitter || 0.0
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
                    client_metrics.rtc_pli_count =
                      videoTrackReport.pliCount || 0
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
        this.pc?.addEventListener?.('track', this.onTrack)

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
            this.state = {
              type: EngineConnectionStateType.ConnectionEstablished,
            }

            this.engineCommandManager.inSequence = 1

            this.dispatchEvent(
              new CustomEvent(EngineConnectionEvents.Opened, { detail: this })
            )
            markOnce('code/endInitialEngineConnect')
          }
          this.unreliableDataChannel?.addEventListener(
            'open',
            this.onDataChannelOpen
          )

          this.onDataChannelClose = (event) => {
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
            this.disconnectAll()
          }

          this.unreliableDataChannel?.addEventListener(
            'close',
            this.onDataChannelClose
          )

          this.onDataChannelError = (event) => {
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
            this.disconnectAll()
          }
          this.unreliableDataChannel?.addEventListener(
            'error',
            this.onDataChannelError
          )

          this.onDataChannelMessage = (event) => {
            const result: UnreliableResponses = JSON.parse(event.data)
            Object.values(
              this.engineCommandManager.unreliableSubscriptions[result.type] ||
                {}
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
        this.pc?.addEventListener?.('datachannel', this.onDataChannel)
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

          // This is required for when KCMA is running stand-alone / within desktop app.
          // Otherwise when run in a browser, the token is sent implicitly via
          // the Cookie header.
          if (this.token) {
            this.send({
              type: 'headers',
              headers: {
                Authorization: `Bearer ${this.token}`,
              },
            })
          }

          // Send an initial ping
          this.send({ type: 'ping' })
          this.pingPongSpan.ping = new Date()
        }
        this.websocket.addEventListener('open', this.onWebSocketOpen)

        this.onWebSocketClose = (event) => {
          this.websocket?.removeEventListener('open', this.onWebSocketOpen)
          this.websocket?.removeEventListener('close', this.onWebSocketClose)
          this.websocket?.removeEventListener('error', this.onWebSocketError)
          this.websocket?.removeEventListener(
            'message',
            this.onWebSocketMessage
          )

          window.removeEventListener(
            'use-network-status-ready',
            this.onNetworkStatusReady
          )

          this.disconnectAll()
        }
        this.websocket.addEventListener('close', this.onWebSocketClose)

        this.onWebSocketError = (event) => {
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

          this.disconnectAll()
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

          const message: Models['WebSocketResponse_type'] = JSON.parse(
            event.data
          )

          if (!message.success) {
            const errorsString = message?.errors
              ?.map((error) => {
                return `  - ${error.error_code}: ${error.message}`
              })
              .join('\n')
            if (message.request_id) {
              console.error(
                `Error in response to request ${message.request_id}:\n${errorsString}
    failed`
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

            case 'modeling_session_data':
              let api_call_id = resp.data?.session?.api_call_id
              console.log(`API Call ID: ${api_call_id}`)
              break

            // Only fires on successful authentication.
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
                  this.disconnectAll()
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

              this.sdpAnswer = toRTCSessionDescriptionInit(answer)

              // We might have received this after ice candidates finish
              // Make sure we attempt to connect when we do.
              this.initiateConnectionExclusive()
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
    })
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
    // Not connected, don't send anything
    if (this.websocket?.readyState === 3) return

    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.websocket?.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }
  disconnectAll() {
    if (this.websocket?.readyState === 1) {
      this.websocket?.close()
    }
    if (this.unreliableDataChannel?.readyState === 'open') {
      this.unreliableDataChannel?.close()
    }
    if (this.pc?.connectionState === 'connected') {
      this.pc?.close()
    }

    this.webrtcStatsCollector = undefined

    // Already triggered
    if (this.state.type === EngineConnectionStateType.Disconnected) return

    const closedPc = !this.pc || this.pc?.connectionState === 'closed'
    const closedUDC =
      !this.unreliableDataChannel ||
      this.unreliableDataChannel?.readyState === 'closed'

    // Do not check when timing out because websockets take forever to
    // report their disconnected state.
    const closedWS =
      (this.state.type === EngineConnectionStateType.Disconnecting &&
        this.state.value.type === DisconnectingType.Timeout) ||
      !this.websocket ||
      this.websocket?.readyState === 3

    if (closedPc && closedUDC && closedWS) {
      // Do not notify the rest of the program that we have cut off anything.
      this.state = { type: EngineConnectionStateType.Disconnected }
      this.triggeredStart = false
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
  // engineConnection is available but scene setup may not have run
  EngineAvailable = 'engine-available',

  // the whole scene is ready (settings loaded)
  SceneReady = 'scene-ready',
}

/**
 * The EngineCommandManager is the main interface to the Engine for Modeling App.
 *
 * It is responsible for sending commands to the Engine, and managing the state
 * of those commands. It also sets up and tears down the connection to the Engine
 * through the {@link EngineConnection} class.
 *
 * As commands are send their state is tracked in {@link pendingCommands} and clear as soon as we receive a response.
 *
 * Also all commands that are sent are kept track of in WASM and their responses are kept in {@link responseMap}
 */

interface PendingMessage {
  command: EngineCommand
  range: SourceRange
  idToRangeMap: { [key: string]: SourceRange }
  resolve: (data: [Models['WebSocketResponse_type']]) => void
  reject: (reason: string) => void
  promise: Promise<[Models['WebSocketResponse_type']]>
  isSceneCommand: boolean
}
export class EngineCommandManager extends EventTarget {
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
  /**
   * The latest sequence number received from the engine over the *unreliable* channel.
   * This is compared to the {@link outSequence} number to determine if we should ignore
   * any out-of-order late responses in the unreliable channel.
   */
  inSequence = 1
  engineConnection?: EngineConnection
  commandLogs: CommandLog[] = []
  settings: SettingsViaQueryString

  streamDimensions = {
    // Random defaults that are overwritten pretty much immediately
    width: 1337,
    height: 1337,
  }

  elVideo: HTMLVideoElement | null = null

  _commandLogCallBack: (command: CommandLog[]) => void = () => {}

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

  constructor(settings?: SettingsViaQueryString) {
    super()

    this.engineConnection = undefined
    this.settings = settings
      ? settings
      : {
          pool: null,
          theme: Themes.Dark,
          highlightEdges: true,
          enableSSAO: true,
          showScaleGrid: false,
          cameraProjection: 'perspective',
          cameraOrbit: 'spherical',
        }
  }

  private _camControlsCameraChange = () => {}
  set camControlsCameraChange(cb: () => void) {
    this._camControlsCameraChange = cb
  }

  private onEngineConnectionOpened = () => {}
  private onEngineConnectionClosed = () => {}
  private onDarkThemeMediaQueryChange = (e: MediaQueryListEvent) => {
    this.setTheme(e.matches ? Themes.Dark : Themes.Light).catch(reportRejection)
  }
  private onEngineConnectionStarted = ({ detail: engineConnection }: any) => {}
  private onEngineConnectionNewTrack = ({
    detail,
  }: CustomEvent<NewTrackArgs>) => {}
  modelingSend: ReturnType<typeof useModelingContext>['send'] =
    (() => {}) as any
  kclManager: null | KclManager = null

  // The current "manufacturing machine" aka 3D printer, CNC, etc.
  public machineManager: MachineManager | null = null

  start({
    setMediaStream,
    setIsStreamReady,
    width,
    height,
    token,
    settings = {
      pool: null,
      theme: Themes.Dark,
      highlightEdges: true,
      enableSSAO: true,
      showScaleGrid: false,
      cameraProjection: 'orthographic',
      cameraOrbit: 'spherical',
    },
    // When passed, use a completely separate connecting code path that simply
    // opens a websocket and this is a function that is called when connected.
    callbackOnEngineLiteConnect,
  }: {
    callbackOnEngineLiteConnect?: () => void
    setMediaStream: (stream: MediaStream) => void
    setIsStreamReady: (isStreamReady: boolean) => void
    width: number
    height: number
    token?: string
    settings?: SettingsViaQueryString
  }) {
    if (settings) {
      this.settings = settings
    }
    if (width === 0 || height === 0) {
      return
    }

    this.streamDimensions = {
      width,
      height,
    }

    // If we already have an engine connection, just need to resize the stream.
    if (this.engineConnection) {
      this.handleResize(this.streamDimensions)
      return
    }

    let additionalSettings = this.settings.enableSSAO ? '&post_effect=ssao' : ''
    additionalSettings +=
      '&show_grid=' + (this.settings.showScaleGrid ? 'true' : 'false')
    const pool = !this.settings.pool ? '' : `&pool=${this.settings.pool}`
    const url = `${VITE_KC_API_WS_MODELING_URL}?video_res_width=${width}&video_res_height=${height}${additionalSettings}${pool}`
    this.engineConnection = new EngineConnection({
      engineCommandManager: this,
      url,
      token,
      callbackOnEngineLiteConnect,
    })

    // Nothing more to do when using a lite engine initialization
    if (callbackOnEngineLiteConnect) return

    this.dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.EngineAvailable, {
        detail: this.engineConnection,
      })
    )

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.onEngineConnectionOpened = async () => {
      // Set the stream's camera projection type
      // We don't send a command to the engine if in perspective mode because
      // for now it's the engine's default.
      if (settings.cameraProjection === 'orthographic') {
        this.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_set_orthographic',
          },
        }).catch(reportRejection)
      }

      // Set the theme
      this.setTheme(this.settings.theme).catch(reportRejection)
      // Set up a listener for the dark theme media query
      darkModeMatcher?.addEventListener(
        'change',
        this.onDarkThemeMediaQueryChange
      )

      // Set the edge lines visibility
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'edge_lines_visible' as any, // TODO: update kittycad.ts to use the correct type
          hidden: !this.settings.highlightEdges,
        },
      })

      this._camControlsCameraChange()
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.sendSceneCommand({
        // CameraControls subscribes to default_camera_get_settings response events
        // firing this at connection ensure the camera's are synced initially
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_get_settings',
        },
      })
      setIsStreamReady(true)

      // Other parts of the application should use this to react on scene ready.
      this.dispatchEvent(
        new CustomEvent(EngineCommandManagerEvents.SceneReady, {
          detail: this.engineConnection,
        })
      )
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
        let message: Models['WebSocketResponse_type'] | null = null

        if (event.data instanceof ArrayBuffer) {
          // BSON deserialize the command.
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
          // We should never get here.
          console.error('Received a null message from the engine', event)
          return
        }

        const pending = this.pendingCommands[message.request_id || '']

        if (pending && !message.success) {
          // handle bad case
          pending.reject(JSON.stringify(message))
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
        )
          return

        if (message.resp.type === 'export' && message.request_id) {
          this.responseMap[message.request_id] = message.resp
        } else if (
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

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.engineConnection?.connect()
    }
    this.engineConnection.addEventListener(
      EngineConnectionEvents.ConnectionStarted,
      this.onEngineConnectionStarted
    )

    return
  }

  handleResize({ width, height }: { width: number; height: number }) {
    if (!this.engineConnection?.isReady()) {
      return
    }

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
        fps: 60,
      },
    }
    this.engineConnection?.send(resizeCmd)
  }

  tearDown(opts?: { idleMode: boolean }) {
    if (this.engineConnection) {
      for (const pending of Object.values(this.pendingCommands)) {
        pending.reject('no connection to send on')
      }

      this.engineConnection?.removeEventListener?.(
        EngineConnectionEvents.Opened,
        this.onEngineConnectionOpened
      )
      this.engineConnection.removeEventListener?.(
        EngineConnectionEvents.Closed,
        this.onEngineConnectionClosed
      )
      this.engineConnection.removeEventListener?.(
        EngineConnectionEvents.ConnectionStarted,
        this.onEngineConnectionStarted
      )
      this.engineConnection.removeEventListener?.(
        EngineConnectionEvents.NewTrack,
        this.onEngineConnectionNewTrack as EventListener
      )
      darkModeMatcher?.removeEventListener(
        'change',
        this.onDarkThemeMediaQueryChange
      )

      this.engineConnection?.tearDown(opts)

      // Our window.engineCommandManager.tearDown assignment causes this case to happen which is
      // only really for tests.
      // @ts-ignore
    } else if (this.engineCommandManager?.engineConnection) {
      // @ts-ignore
      this.engineCommandManager?.engineConnection?.tearDown(opts)
    }
  }
  async startNewSession() {
    this.responseMap = {}
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
  async sendSceneCommand(
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
        return e
      })
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
    if (this.engineConnection === undefined) return Promise.resolve()
    if (
      !this.engineConnection?.isReady() &&
      !this.engineConnection.isUsingConnectionLite
    )
      return Promise.resolve()
    if (id === undefined) return Promise.reject(new Error('id is undefined'))
    if (rangeStr === undefined)
      return Promise.reject(new Error('rangeStr is undefined'))
    if (commandStr === undefined)
      return Promise.reject(new Error('commandStr is undefined'))
    const range: SourceRange = JSON.parse(rangeStr)
    const command: EngineCommand = JSON.parse(commandStr)
    const idToRangeMap: { [key: string]: SourceRange } =
      JSON.parse(idToRangeStr)

    // Current executeAst is stale, going to interrupt, a new executeAst will trigger
    // Used in conjunction with rejectAllModelingCommands
    if (this?.kclManager?.executeIsStale) {
      return Promise.reject(EXECUTE_AST_INTERRUPT_ERROR_MESSAGE)
    }

    const resp = await this.sendCommand(id, {
      command,
      range,
      idToRangeMap,
    })
    return BSON.serialize(resp[0])
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
  ): Promise<[Models['WebSocketResponse_type']]> {
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

    this.engineConnection?.send(message.command)
    return promise
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
    Object.values(this.pendingCommands).forEach(
      ({ reject, isSceneCommand }) =>
        !isSceneCommand && reject(rejectionMessage)
    )
  }

  async setPlaneHidden(id: string, hidden: boolean) {
    if (this.engineConnection === undefined) return

    // Can't send commands if there's no connection
    if (
      this.engineConnection.state.type ===
        EngineConnectionStateType.Disconnecting ||
      this.engineConnection.state.type ===
        EngineConnectionStateType.Disconnected
    )
      return

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
   * Set the engine's theme
   */
  async setTheme(theme: Themes) {
    // Set the stream background color
    // This takes RGBA values from 0-1
    // So we convert from the conventional 0-255 found in Figma
    this.sendSceneCommand({
      cmd_id: uuidv4(),
      type: 'modeling_cmd_req',
      cmd: {
        type: 'set_background_color',
        color: getThemeColorForEngine(theme),
      },
    }).catch(reportRejection)

    // Sets the default line colors
    const opposingTheme = getOppositeTheme(theme)
    this.sendSceneCommand({
      cmd_id: uuidv4(),
      type: 'modeling_cmd_req',
      cmd: {
        type: 'set_default_system_properties',
        color: getThemeColorForEngine(opposingTheme),
      },
    }).catch(reportRejection)
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
