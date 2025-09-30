import type { Connection } from '@src/network/connection'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type { SourceRange } from '@src/lang/wasm'
import type {
  HighlightSetEntity,
  OkModelingCmdResponse,
  RtcSessionDescription,
  WebSocketResponse,
} from '@kittycad/lib/dist/types/src'

// Ping/Pong every 1 second
export const PING_INTERVAL_MS = 1_000

export type ModelTypes = OkModelingCmdResponse['type']
// TODO: Should eventually be replaced with native EventTarget event system,
// as it manages events in a more familiar way to other developers.
export interface Subscription<T extends ModelTypes> {
  event: T
  callback: (data: Extract<OkModelingCmdResponse, { type: T }>) => void
}

export interface NewTrackArgs {
  conn: Connection
  mediaStream: MediaStream
}

// When unreliable responses are listened, check if it is a highlight type
export function isHighlightSetEntity_type(
  data: any
): data is HighlightSetEntity {
  return data.entity_id && data.sequence
}

export type Value<T, U> = U extends undefined
  ? { type: T; value: U }
  : U extends void
    ? { type: T }
    : { type: T; value: U }

export type State<T, U> = Value<T, U>

// internal state to the engine connection class
export enum EngineConnectionStateType {
  Fresh = 'fresh',
  Connecting = 'connecting',
  ConnectionEstablished = 'connection-established',
  Disconnecting = 'disconnecting',
  Disconnected = 'disconnected',
  Paused = 'paused',
}

// internal state to the engine connection class
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
  VeryLongLoadingTime,

  ICENegotiate,
  DataChannelError,
  WebSocketError,
  LocalDescriptionInvalid,

  // These are more severe than protocol errors because they don't even allow
  // the program to do any protocol messages in the first place if they occur.
  MissingAuthToken,
  BadAuthToken,
  TooManyConnections,
  Outage,

  // Observed to happen on a local network outage.
  PeerConnectionRemoteDisconnected,

  // An unknown error is the most severe because it has not been classified
  // or encountered before.
  Unknown,
}

export const CONNECTION_ERROR_TEXT: Record<ConnectionError, string> = {
  [ConnectionError.Unset]: '',
  [ConnectionError.LongLoadingTime]:
    'Loading is taking longer than expected...',
  [ConnectionError.VeryLongLoadingTime]:
    "It's possible there's a connection issue.",
  [ConnectionError.ICENegotiate]: 'ICE negotiation failed.',
  [ConnectionError.DataChannelError]: 'Data channel error.',
  [ConnectionError.WebSocketError]: 'Websocket error.',
  [ConnectionError.LocalDescriptionInvalid]: 'Local description invalid',
  [ConnectionError.MissingAuthToken]: 'Missing authorization token',
  [ConnectionError.BadAuthToken]: 'Bad authorization token',
  [ConnectionError.TooManyConnections]: 'Too many connections',
  [ConnectionError.Outage]: 'Outage',
  [ConnectionError.PeerConnectionRemoteDisconnected]:
    'Peer connection disconnected',
  [ConnectionError.Unknown]: 'Unknown',
}

export const WEBSOCKET_READYSTATE_TEXT: Record<number, string> = {
  [WebSocket.CONNECTING]: 'WebSocket.CONNECTING',
  [WebSocket.OPEN]: 'WebSocket.OPEN',
  [WebSocket.CLOSING]: 'WebSocket.CLOSING',
  [WebSocket.CLOSED]: 'WebSocket.CLOSED',
}

export interface IErrorType {
  // The error we've encountered.
  error: ConnectionError

  // Additional context.
  context?: any

  // We assign this in the state setter because we may have not failed at
  // a Connecting state, which we check for there.
  lastConnectingValue?: ConnectingValue
}

export type DisconnectingValue =
  | State<DisconnectingType.Error, IErrorType>
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
  | State<EngineConnectionStateType.Paused, void>
  | State<EngineConnectionStateType.Disconnected, void>

export enum EngineConnectionEvents {
  // Fires for each ping-pong success or failure.
  PingPongChanged = 'ping-pong-changed', // (state: PingPongState) => void

  // For now, this is only used by the NetworkHealthIndicator.
  // We can eventually use it for more, but one step at a time.
  ConnectionStateChanged = 'connection-state-changed', // (state: EngineConnectionState) => void

  // There are various failure scenarios where we want to try a restart.
  RestartRequest = 'restart-request',

  // These are used for the EngineCommandManager and were created
  // before onConnectionStateChange existed.
  ConnectionStarted = 'connection-started', // (engineConnection: EngineConnection) => void
  Opened = 'opened', // (engineConnection: EngineConnection) => void
  Closed = 'closed', // (engineConnection: EngineConnection) => void
  NewTrack = 'new-track', // (track: NewTrackArgs) => void

  // A general offline state.
  Offline = 'offline',
}

export function toRTCSessionDescriptionInit(
  desc: RtcSessionDescription
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

// Data channels MUST BE specified before SDP offers because requesting
// them affects what our needs are!
export const DATACHANNEL_NAME_UMC = 'unreliable_modeling_cmds'

export type UnreliableResponses = Extract<
  OkModelingCmdResponse,
  { type: 'highlight_set_entity' | 'camera_drag_move' }
>

export enum EngineCommandManagerEvents {
  // engineConnection is available but scene setup may not have run
  EngineAvailable = 'engine-available',

  // request a restart of engineConnection
  EngineRestartRequest = 'engine-restart-request',

  // the whole scene is ready (settings loaded)
  SceneReady = 'scene-ready',

  // we're offline
  Offline = 'offline',

  // websocket event listener for close was called
  WebsocketClosed = 'websocket-closed',

  // RTCPeerConnection processed a failed state in onConnectionStateChange
  peerConnectionFailed = 'peer-connection-failed',

  // RTCPeerConnection processed a disconnected state in onConnectionStateChange
  peerConnectionDisconnected = 'peer-connection-disconnected',

  // RTCPeerConnection processed a closed state in onConnectionStateChange
  peerConnectionClosed = 'peer-connection-closed',

  OnlineRequest = 'online-request',
}

export interface UnreliableSubscription<T extends UnreliableResponses['type']> {
  event: T
  callback: (data: Extract<UnreliableResponses, { type: T }>) => void
}

export interface PendingMessage {
  command: EngineCommand
  range: SourceRange
  idToRangeMap: { [key: string]: SourceRange }
  resolve: (data: [WebSocketResponse]) => void
  // BOTH resolve and reject get passed back to the rust side which
  // assumes it is this type! Do not change it!
  // Format your errors as this type!
  reject: (reason: [WebSocketResponse]) => void
  promise: Promise<[WebSocketResponse]>
  isSceneCommand: boolean
}
export type EventSource =
  | 'window'
  | 'peerConnection'
  | 'websocket'
  | 'unreliableDataChannel'
  | 'connection'
  | 'darkModeMatcher'

export interface IEventListenerTracked {
  event: string
  callback: any
  type: EventSource
}

export function getDimensions(streamWidth: number, streamHeight: number) {
  const factorOf = 4
  const maxResolution = 2160
  const ratio = Math.min(
    Math.min(maxResolution / streamWidth, maxResolution / streamHeight),
    1.0
  )
  const quadWidth = Math.round((streamWidth * ratio) / factorOf) * factorOf
  const quadHeight = Math.round((streamHeight * ratio) / factorOf) * factorOf
  return { width: quadWidth, height: quadHeight }
}

export interface ManagerTearDown {
  websocketClosed?: boolean
  peerConnectionFailed?: boolean
  peerConnectionDisconnected?: boolean
  peerConnectionClosed?: boolean
  code?: string
}

// 7.4.1 Defined Status Codes from RFC 6455 The WebSocket Protocol
export const WebSocketStatusCodes: Readonly<Record<string, string>> =
  Object.freeze({
    /**
     * indicates a normal closure, meaning that the purpose for
     * which the connection was established has been fulfilled.
     */
    '1000': 'normal closure',
    /**
     * indicates that an endpoint is "going away", such as a server
     * going down or a browser having navigated away from a page.
     */
    '1001': 'going away',
    /**
     * indicates that an endpoint is terminating the connection due
     * to a protocol error.
     */
    '1002': 'protocol error',
    /**
     * indicates that an endpoint is terminating the connection
     * because it has received a type of data it cannot accept (e.g., an
     * endpoint that understands only text data MAY send this if it
     * receives a binary message).
     */
    '1003': 'cannot accept data',
    /**
     * Reserved.  The specific meaning might be defined in the future.
     */
    '1004': 'reserved, no meaning',
    /**
     * is a reserved value and MUST NOT be set as a status code in a
     * Close control frame by an endpoint.  It is designated for use in
     * applications expecting a status code to indicate that no status
     * code was actually present.
     */
    '1005': 'no status present',
    /**
     * is a reserved value and MUST NOT be set as a status code in a
     * Close control frame by an endpoint.  It is designated for use in
     * applications expecting a status code to indicate that the
     * connection was closed abnormally, e.g., without sending or
     * receiving a Close control frame.
     */
    '1006': 'abnormally closed',
    /**
     * indicates that an endpoint is terminating the connection
     * because it has received data within a message that was not
     * consistent with the type of the message (e.g., non-UTF-8 [RFC3629]
     * data within a text message).
     */
    '1007': 'received data mismatch type of message',
    /**
     * indicates that an endpoint is terminating the connection
     * because it has received a message that violates its policy.  This
     * is a generic status code that can be returned when there is no
     * other more suitable status code (e.g., 1003 or 1009) or if there
     * is a need to hide specific details about the policy.
     */
    '1008': 'received message violates policy',
    /**
     * indicates that an endpoint is terminating the connection
     * because it has received a message that is too big for it to
     * process.
     */
    '1009': 'received message is too big for process',
    /**
     *  indicates that an endpoint (client) is terminating the
     *  connection because it has expected the server to negotiate one or
     *  more extension, but the server didn't return them in the response
     *  message of the WebSocket handshake.  The list of extensions that
     *  are needed SHOULD appear in the /reason/ part of the Close frame.
     *  Note that this status code is not used by the server, because it
     *  can fail the WebSocket handshake instead.
     */
    '1010': 'extension not found',
    /**
     * indicates that a server is terminating the connection because
     * it encountered an unexpected condition that prevented it from
     * fulfilling the request.
     */
    '1011': 'unexpected condition from server',
    /**
     * is a reserved value and MUST NOT be set as a status code in a
     * Close control frame by an endpoint.  It is designated for use in
     * applications expecting a status code to indicate that the
     * connection was closed due to a failure to perform a TLS handshake
     * (e.g., the server certificate can't be verified).
     */
    '1015': 'TLS handshake failure',
  } as const)

export const REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE = `Rejected because send was too early, WebSocket.readyState was not WebSocket.OPEN`
