import type { Models } from '@kittycad/lib'
import { Connection } from './connection'
import { EngineCommand } from '@src/lang/std/artifactGraph'
import { SourceRange } from '@src/lang/wasm'

// Ping/Pong every 1 second
export const pingIntervalMs = 1_000

export type ModelTypes = Models['OkModelingCmdResponse_type']['type']
// TODO: Should eventually be replaced with native EventTarget event system,
// as it manages events in a more familiar way to other developers.
export interface Subscription<T extends ModelTypes> {
  event: T
  callback: (
    data: Extract<Models['OkModelingCmdResponse_type'], { type: T }>
  ) => void
}

export interface NewTrackArgs {
  conn: Connection
  mediaStream: MediaStream
}

// When unreliable responses are listened, check if it is a highlight type
export function isHighlightSetEntity_type(
  data: any
): data is Models['HighlightSetEntity_type'] {
  return data.entity_id && data.sequence
}

export type ClientMetrics = Models['ClientMetrics_type']

export type Value<T, U> = U extends undefined
  ? { type: T; value: U }
  : U extends void
    ? { type: T }
    : { type: T; value: U }

export type State<T, U> = Value<T, U>

// internal state to the engine connnection class
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

// Data channels MUST BE specified before SDP offers because requesting
// them affects what our needs are!
export const DATACHANNEL_NAME_UMC = 'unreliable_modeling_cmds'

export function logger(s1: any, s2: any) {
  console.log('[connection]', s1, s2)
}

export type UnreliableResponses = Extract<
  Models['OkModelingCmdResponse_type'],
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
}

export interface UnreliableSubscription<T extends UnreliableResponses['type']> {
  event: T
  callback: (data: Extract<UnreliableResponses, { type: T }>) => void
}

export interface PendingMessage {
  command: EngineCommand
  range: SourceRange
  idToRangeMap: { [key: string]: SourceRange }
  resolve: (data: [Models['WebSocketResponse_type']]) => void
  // BOTH resolve and reject get passed back to the rust side which
  // assumes it is this type! Do not change it!
  // Format your errors as this type!
  reject: (reason: [Models['WebSocketResponse_type']]) => void
  promise: Promise<[Models['WebSocketResponse_type']]>
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

export function promiseFactory<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {}
  let reject: (value: T | PromiseLike<T>) => void = () => {}
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}
