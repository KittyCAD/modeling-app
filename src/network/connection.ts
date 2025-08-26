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
import {
  createOnWebSocketClose,
  createOnWebSocketError,
  createOnWebSocketMessage,
  createOnWebSocketOpen,
} from './websocketConnection'
import { C } from 'vitest/dist/chunks/reporters.d.79o4mouw'

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
  private readonly _token: string | undefined

  // ping pong result
  private _pingPongSpan: {
    ping: number | undefined
    pong: number | undefined
  }
  private _pingIntervalId: ReturnType<typeof setInterval> | undefined =
    undefined

  private peerConnection: RTCPeerConnection | undefined

  unreliableDataChannel: RTCDataChannel | undefined
  mediaStream: MediaStream | undefined
  websocket: WebSocket | undefined
  sdpAnswer: RTCSessionDescriptionInit | undefined

  // Track if the connection has been completed or not
  connectionPromise: Promise<unknown> | null
  connectionPromiseResolve: ((value: unknown) => void) | null
  connectionPromiseReject: ((value: unknown) => void) | null

  iceCandidatePromises: Promise<unknown>[]

  // event listeners to add and clean up
  public webrtcStatsCollector?: () => Promise<ClientMetrics>

  // TODO: offer promise wrapped to track

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
    this._token = token
    this._pingPongSpan = { ping: undefined, pong: undefined }
    this.connectionPromise = null
    this.connectionPromiseResolve = null
    this.connectionPromiseReject = null
    this.iceCandidatePromises = []
  }

  get token() {
    return this._token
  }

  get pingPongSpan() {
    return this._pingPongSpan
  }

  get pingIntervalId() {
    return this._pingIntervalId
  }

  /***
   * Do not start this until we are EngineConnectionStateType.ConnectionEstablished
   * lifecycle that needs to start and stop.
   */
  startPingPong() {
    this._pingIntervalId = setInterval(() => {
      if (this._pingPongSpan.ping) {
        return
      }

      this.send({ type: 'ping' })
      this._pingPongSpan = {
        ping: Date.now(),
        pong: undefined,
      }
    }, pingIntervalMs)
  }

  stopPingPong() {
    clearInterval(this._pingIntervalId)
    this._pingIntervalId = undefined
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

  initiateConnectionExclusive() {
    throw new Error('initiateConnectionExclusive unimplemented')
  }

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
    return this.peerConnection
  }

  createWebSocketConnection() {
    this.websocket = new WebSocket(this.url, [])
    this.websocket.binaryType = 'arraybuffer'

    const onWebSocketOpen = createOnWebSocketOpen({
      send: this.send,
      token: this.token,
    })
    const onWebSocketError = createOnWebSocketError()
    const onWebSocketMessage = createOnWebSocketMessage({
      connectionManager: this.connectionManager,
      disconnectAll: this.disconnectAll,
      setPong: this.setPong,
      dispatchEvent: this.dispatchEvent,
      ping: () => {
        return this._pingPongSpan.ping
      },
      setPing: this.setPing,
      createPeerConnection: this.createPeerConnection,
      send: this.send,
      setSdpAnswer: this.setSdpAnswer,
      initiateConnectionExclusive: this.initiateConnectionExclusive,
      addIceCandidate: this.addIceCandidate,
      webrtcStatsCollector: this.webrtcStatsCollector,
    })
    const onWebSocketClose = createOnWebSocketClose({
      websocket: this.websocket,
      onWebSocketOpen: onWebSocketOpen,
      onWebSocketError: onWebSocketError,
      onWebSocketMessage: onWebSocketMessage,
      disconnectAll: this.disconnectAll,
      dispatchEvent: this.dispatchEvent
    })

    const metaClose = () => {
      onWebSocketClose()
    }

    this.websocket.addEventListener('open', onWebSocketOpen)
    this.websocket.addEventListener('error', onWebSocketError)
    this.websocket.addEventListener('message', onWebSocketMessage)
    this.websocket.addEventListener('close', metaClose)

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

  setPong(pong: number) {
    this._pingPongSpan.pong = pong
  }

  setPing(ping: number | undefined) {
    this._pingPongSpan.ping = ping
  }

  setSdpAnswer(answer: RTCSessionDescriptionInit) {
    this.sdpAnswer = answer
  }

  disconnectAll() {
    throw new Error('disconnectAll unimplemented')
  }

  cleanUp() {
    throw new Error('cleanUp')
  }

  addIceCandidate(candidate: RTCIceCandidateInit) {
    // Do we need this awaited before we can say it is completed?
    // Probably...
    // I think I should make a default one that is pending until called?

    if (!this.peerConnection) {
      throw new Error('do not do this, crashing!')
    }

    const tracker = new Promise(async (resolve, reject) => {
      try {
        const result = await this.peerConnection?.addIceCandidate(candidate)
        resolve(result)
      } catch (e) {
        reject(e)
      }
    })
    this.iceCandidatePromises.push(tracker)
  }
}
