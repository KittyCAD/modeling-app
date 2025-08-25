import { markOnce } from '@src/lib/performance'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { ClientMetrics } from './utils'
import { DATACHANNEL_NAME_UMC, pingIntervalMs } from './utils'
import {
  createOnConnectionStateChange,
  createOnDataChannel,
  createOnIceCandidate,
  createOnIceCandidateError,
  createOnIceConnectionStateChange,
  createOnIceGatheringStateChange,
  createOnNegotiationNeeded,
  createOnSignalingStateChange,
  createOnTrack,
  createWebrtcStatsCollector,
} from './peerConnection'
import type { Models } from '@kittycad/lib'
import { createOnWebSocketError, createOnWebSocketOpen } from './websocketConnection'

export interface INewTrackArgs {
  conn: Connection
  mediaStream: MediaStream
}

export class Connection extends EventTarget {
  // connection manager?
  connectionManager: ConnectionManager
  // connection url for the new Websocket()
  readonly url: string
  // Authorization bearer token for headers on websocket
  private readonly token: string | undefined

  // ping pong result
  private pingPongSpan: {
    ping: number | undefined
    pong: number | undefined
  }
  private pingIntervalId: ReturnType<typeof setInterval> | undefined = undefined

  private peerConnection: RTCPeerConnection | undefined

  unreliableDataChannel: RTCDataChannel | undefined
  mediaStream: MediaStream | undefined
  websocket: WebSocket | undefined

  // Track if the connection has been completed or not
  connectionPromise: Promise<unknown> | null
  connectionPromiseResolve: ((value: unknown) => void) | null
  connectionPromiseReject: ((value: unknown) => void) | null

  // event listeners to add and clean up
  public webrtcStatsCollector?: () => Promise<ClientMetrics>

  constructor({
    connectionManager,
    url,
    token,
  }: {
    connectionManager: ConnectionManager
    url: string
    token: string
  }) {
    markOnce('code/startInitialEngineConnect')
    super()
    this.connectionManager = connectionManager
    this.url = url
    this.token = token
    this.pingPongSpan = { ping: undefined, pong: undefined }
    this.connectionPromise = null
    this.connectionPromiseResolve = null
    this.connectionPromiseReject = null
  }

  /***
   * Do not start this until we are EngineConnectionStateType.ConnectionEstablished
   * lifecycle that needs to start and stop.
   */
  startPingPong() {
    this.pingIntervalId = setInterval(() => {
      if (this.pingPongSpan.ping) {
        return
      }

      this.send({ type: 'ping' })
      this.pingPongSpan = {
        ping: Date.now(),
        pong: undefined,
      }
    }, pingIntervalMs)
  }

  send(message: Models['WebSocketRequest_type']) {}

  connect(): Promise<unknown> {
    if (this.connectionPromise) {
      Promise.reject('currently connecting, try again later.')
    }

    const connectionPromise = new Promise((resolve, reject) => {
      this.connectionPromiseResolve = resolve
      this.connectionPromiseReject = reject
    })
    this.connectionPromise = connectionPromise
    return connectionPromise
  }

  initiateConnectionExclusive() {}

  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      bundlePolicy: 'max-bundle',
    })
    this.peerConnection.createDataChannel(DATACHANNEL_NAME_UMC)

    const onIceCandidate = createOnIceCandidate({
      initiateConnectionExclusive: this.initiateConnectionExclusive,
      send: this.send,
    })
    const onIceGatheringStateChange = createOnIceGatheringStateChange({
      initiateConnectionExclusive: this.initiateConnectionExclusive,
    })
    const onIceConnectionStateChange = createOnIceConnectionStateChange()
    const onNegotiationNeeded = createOnNegotiationNeeded()
    const onSignalingStateChange = createOnSignalingStateChange()
    const onIceCandidateError = createOnIceCandidateError()
    const onConnectionStateChange = createOnConnectionStateChange({
      dispatchEvent: this.dispatchEvent,
      connection: this,
      disconnectAll: this.disconnectAll,
      cleanUp: this.cleanUp,
    })
    const onTrack = createOnTrack({
      setMediaStream: this.setMediaStream,
      setWebrtcStatsCollector: this.setWebrtcStatsCollector,
      peerConnection: this.peerConnection,
    })

    // Has a callback workflow that will create a unreliabledatachannel
    const onDataChannel = createOnDataChannel({
      setUnreliableDataChannel: this.setUnreliableDataChannel,
      dispatchEvent: this.dispatchEvent,
    })

    // Watch out human! The names of the next couple events are really similar!
    this.peerConnection.addEventListener('icecandidate', onIceCandidate)
    this.peerConnection.addEventListener(
      'icegatheringstatechange',
      onIceGatheringStateChange
    )
    this.peerConnection.addEventListener(
      'iceconnectionstatechange',
      onIceConnectionStateChange
    )
    this.peerConnection.addEventListener(
      'negotiationneeded',
      onNegotiationNeeded
    )
    this.peerConnection.addEventListener(
      'signalingstatechange',
      onSignalingStateChange
    )
    this.peerConnection.addEventListener(
      'icecandidateerror',
      onIceCandidateError
    )
    this.peerConnection.addEventListener(
      'connectionstatechange',
      onConnectionStateChange
    )
    this.peerConnection.addEventListener('track', onTrack)
    this.peerConnection.addEventListener('datachannel', onDataChannel)

    // TODO: Save off all event listener functions and remove thme in clean up
    // recusively for any nested classes with event listener callbacks as well
  }

  createWebSocketConnection () {
    this.websocket = new WebSocket(this.url, [])
    this.websocket.binaryType = 'arraybuffer'

    const onWebSocketOpen = createOnWebSocketOpen({
      send: this.send,
      token: this.token
    })

    const onWebSocketError = createOnWebSocketError()

    this.websocket.addEventListener('open', onWebSocketOpen)
    this.websocket.addEventListener('error', onWebSocketError)
  
    // TODO: Save off all callbacks to remove from the event listener in the cleanUp function
  }

  setMediaStream(mediaStream: MediaStream) {
    this.mediaStream = mediaStream
  }

  setWebrtcStatsCollector(webrtcStatsCollector: () => Promise<ClientMetrics>) {
    this.webrtcStatsCollector = webrtcStatsCollector
  }

  setUnreliableDataChannel(channel: RTCDataChannel) {
    this.unreliableDataChannel = channel
  }

  disconnectAll() {
    throw new Error('disconnectAll unimplemented')
  }

  cleanUp() {
    throw new Error('cleanUp')
  }
}
