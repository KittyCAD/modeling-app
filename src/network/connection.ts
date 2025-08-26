import { markOnce } from '@src/lib/performance'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { ClientMetrics } from './utils'
import { DATACHANNEL_NAME_UMC, logger, pingIntervalMs } from './utils'
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
} from './peerConnection'
import type { Models } from '@kittycad/lib'
import {
  createOnWebSocketClose,
  createOnWebSocketError,
  createOnWebSocketMessage,
  createOnWebSocketOpen,
} from './websocketConnection'

export interface INewTrackArgs {
  conn: Connection
  mediaStream: MediaStream
}

export type EventSource =
  | 'window'
  | 'peerConnection'
  | 'websocket'
  | 'unreliableDataChannel'

export interface IEventListenerTracked {
  event: string
  callback: any
  type: EventSource
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
  private _pingIntervalId: ReturnType<typeof setInterval> | undefined
  timeoutToForceConnectId: ReturnType<typeof setTimeout> | undefined

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
  onNetworkStatusReady: (() => void) | undefined

  public webrtcStatsCollector: (() => Promise<ClientMetrics>) | undefined

  // Any event listener into this map to be cleaned up later
  // helps avoids duplicates as well
  allEventListeners: Map<string, IEventListenerTracked>

  // We spam initiateConnectionExclusive but we only need it to connect once
  // future calls will be rejected.
  exclusiveConnection: boolean

  // TODO: offer promise wrapped to track
  // TODo: event listeners to add and clean up

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
    this.allEventListeners = new Map()
    // No connection has been made when the class is initialized
    this.exclusiveConnection = false
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

  // TODO: Pass reconnect here? or call a function for reconnect
  connect(): Promise<unknown> {
    if (this.connectionPromise) {
      Promise.reject('currently connecting, try again later.')
    }

    const connectionPromise = new Promise((resolve, reject) => {
      this.connectionPromiseResolve = resolve
      this.connectionPromiseReject = reject
    })
    this.connectionPromise = connectionPromise

    // TODO: reconnect with createWebSocketConnection only?
    if (this.onNetworkStatusReady) {
      throw new Error('onNetworkStatusReady already exists, you messed up.')
    }

    // Once the engine is availabe create a web socket connection
    this.onNetworkStatusReady = () => {
      logger('onnetworkstatusready', {})
      this.createWebSocketConnection()
    }

    // Event comes from onEngineAvailable in the connection manager
    this.trackListener('use-network-status-ready', {
      event: 'use-network-status-ready',
      callback: this.onNetworkStatusReady,
      type: 'window',
    })
    window.addEventListener(
      'use-network-status-ready',
      this.onNetworkStatusReady
    )

    return connectionPromise
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

  /**
   * This function is being spammed.
   * You can call this before sdpAnswer is ready.
   */
  async initiateConnectionExclusive() {
    if (!this.peerConnection) {
      throw new Error('peerConnection is undefined')
    }

    if (!this.sdpAnswer) {
      throw new Error('sdpAnswer is undefined')
    }

    if (this.exclusiveConnection) {
      logger('dropping initiateConnectionExclusive, it has already started', {})
      return
    }

    this.exclusiveConnection = true

    try {
      await this.peerConnection.setRemoteDescription(this.sdpAnswer)
      this.cleanUpTimeouts()
    } catch (error) {
      console.error('Failed to set remote description:', error)
      this.disconnectAll()
    }
  }

  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      bundlePolicy: 'max-bundle',
    })
    this.peerConnection.createDataChannel(DATACHANNEL_NAME_UMC)

    const onIceCandidate = createOnIceCandidate({
      initiateConnectionExclusive: this.initiateConnectionExclusive.bind(this),
      send: this.send.bind(this),
      setTimeoutToForceConnectId: this.setTimeoutToForceConnectId.bind(this),
    })
    const onIceGatheringStateChange = createOnIceGatheringStateChange({
      initiateConnectionExclusive: this.initiateConnectionExclusive.bind(this),
    })
    const onIceConnectionStateChange = createOnIceConnectionStateChange()
    const onNegotiationNeeded = createOnNegotiationNeeded()
    const onSignalingStateChange = createOnSignalingStateChange()
    const onIceCandidateError = createOnIceCandidateError()
    const onConnectionStateChange = createOnConnectionStateChange({
      dispatchEvent: this.dispatchEvent.bind(this),
      connection: this,
      disconnectAll: this.disconnectAll.bind(this),
      cleanUp: this.cleanUp.bind(this),
    })
    const onTrack = createOnTrack({
      setMediaStream: this.setMediaStream.bind(this),
      setWebrtcStatsCollector: this.setWebrtcStatsCollector.bind(this),
      peerConnection: this.peerConnection,
    })

    // Has a callback workflow that will create a unreliabledatachannel
    const onDataChannel = createOnDataChannel({
      setUnreliableDataChannel: this.setUnreliableDataChannel.bind(this),
      dispatchEvent: this.dispatchEvent.bind(this),
      trackListener: this.trackListener.bind(this),
    })

    // Watch out human! The names of the next couple events are really similar!
    this.trackListener('icecandidate', {
      event: 'icecandidate',
      callback: onIceCandidate,
      type: 'peerConnection',
    })
    this.peerConnection.addEventListener('icecandidate', onIceCandidate)

    this.trackListener('icegatheringstatechange', {
      event: 'icegatheringstatechange',
      callback: onIceGatheringStateChange,
      type: 'peerConnection',
    })
    this.peerConnection.addEventListener(
      'icegatheringstatechange',
      onIceGatheringStateChange
    )

    this.trackListener('iceconnectionstatechange', {
      event: 'iceconnectionstatechange',
      callback: onIceConnectionStateChange,
      type: 'peerConnection',
    })
    this.peerConnection.addEventListener(
      'iceconnectionstatechange',
      onIceConnectionStateChange
    )

    this.trackListener('negotiationneeded', {
      event: 'negotiationneeded',
      callback: onNegotiationNeeded,
      type: 'peerConnection',
    })
    this.peerConnection.addEventListener(
      'negotiationneeded',
      onNegotiationNeeded
    )

    this.trackListener('signalingstatechange', {
      event: 'signalingstatechange',
      callback: onSignalingStateChange,
      type: 'peerConnection',
    })
    this.peerConnection.addEventListener(
      'signalingstatechange',
      onSignalingStateChange
    )

    this.trackListener('icecandidateerror', {
      event: 'icecandidateerror',
      callback: onIceCandidateError,
      type: 'peerConnection',
    })

    this.peerConnection.addEventListener(
      'icecandidateerror',
      onIceCandidateError
    )

    this.trackListener('connectionstatechange', {
      event: 'connectionstatechange',
      callback: onConnectionStateChange,
      type: 'peerConnection',
    })
    this.peerConnection.addEventListener(
      'connectionstatechange',
      onConnectionStateChange
    )

    this.trackListener('track', {
      event: 'track',
      callback: onTrack,
      type: 'peerConnection',
    })
    this.peerConnection.addEventListener('track', onTrack)

    this.trackListener('datachannel', {
      event: 'datachannel',
      callback: onDataChannel,
      type: 'peerConnection',
    })
    this.peerConnection.addEventListener('datachannel', onDataChannel)

    // TODO: Save off all event listener functions and remove thme in clean up
    // recusively for any nested classes with event listener callbacks as well
    return this.peerConnection
  }

  createWebSocketConnection() {
    this.websocket = new WebSocket(this.url, [])
    this.websocket.binaryType = 'arraybuffer'

    const onWebSocketOpen = createOnWebSocketOpen({
      send: this.send.bind(this),
      token: this.token,
    })
    const onWebSocketError = createOnWebSocketError()
    const onWebSocketMessage = createOnWebSocketMessage({
      connectionManager: this.connectionManager,
      disconnectAll: this.disconnectAll.bind(this),
      setPong: this.setPong.bind(this),
      dispatchEvent: this.dispatchEvent.bind(this),
      ping: () => {
        return this._pingPongSpan.ping
      },
      setPing: this.setPing.bind(this),
      createPeerConnection: this.createPeerConnection.bind(this),
      send: this.send.bind(this),
      setSdpAnswer: this.setSdpAnswer.bind(this),
      initiateConnectionExclusive: this.initiateConnectionExclusive.bind(this),
      addIceCandidate: this.addIceCandidate.bind(this),
      webrtcStatsCollector: () => this.webrtcStatsCollector?.bind(this),
    })
    const onWebSocketClose = createOnWebSocketClose({
      websocket: this.websocket,
      onWebSocketOpen: onWebSocketOpen,
      onWebSocketError: onWebSocketError,
      onWebSocketMessage: onWebSocketMessage,
      disconnectAll: this.disconnectAll.bind(this),
      dispatchEvent: this.dispatchEvent.bind(this),
    })

    // Meta close will remove all the internal events itself but then the this.websocket.close
    // needs to remove itself so it is wrapped in a metaClose.
    const metaClose = () => {
      onWebSocketClose()
    }

    // the first key name can be anything, the event needs to be the actual eventlistener event name.
    // multiple JS classes may have a open event listener so we cannot globally register multiple
    // open values in the Map. The value can store that same event:'open'
    this.trackListener('websocket-open', {
      event: 'open',
      callback: onWebSocketOpen,
      type: 'websocket',
    })
    this.websocket.addEventListener('open', onWebSocketOpen)
    this.trackListener('websocket-error', {
      event: 'error',
      callback: onWebSocketError,
      type: 'websocket',
    })
    this.websocket.addEventListener('error', onWebSocketError)
    this.trackListener('websocket-message', {
      event: 'message',
      callback: onWebSocketMessage,
      type: 'websocket',
    })
    this.websocket.addEventListener('message', onWebSocketMessage)
    this.trackListener('websocket-close', {
      event: 'close',
      callback: metaClose,
      type: 'websocket',
    })
    this.websocket.addEventListener('close', metaClose)
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

  setTimeoutToForceConnectId(id: ReturnType<typeof setTimeout>) {
    this.timeoutToForceConnectId = id
  }

  // Attempt a ton of clean up. Log if you cannot.
  disconnectAll() {
    // Clean up all the event listeners
    this.removeAllEventListeners()
    this.disconnectWebsocket()
    this.disconnectUnreliableDataChannel()
    this.disconnectPeerConnection()
    // Function generated from createPeerConnection workflow
    this.webrtcStatsCollector = undefined
    this.cleanUpTimeouts()

    logger(
      'cleaned up websocket, unreliable data channel, and peer connection, all event listeners removed',
      {}
    )
    // TODO: Missing some logic for idle mode and timeouts of websocket??
    // I think for idle mode we cannot remove all the listeners? Need to manage this.
  }

  disconnectWebsocket() {
    if (!this.websocket) {
      throw new Error('websocket is undefined')
    }

    if (this.websocket.readyState < WebSocket.CLOSED) {
      this.websocket.close()
    } else {
      throw new Error(
        `websocket is defined but readyState is wrong ${this.websocket.readyState}`
      )
    }
  }

  disconnectUnreliableDataChannel() {
    if (!this.unreliableDataChannel) {
      // throw new Error('unreliableDataChannel is undefined')
      logger('unreliableDataChannel is undefined', {})
      return
    }

    if (this.unreliableDataChannel.readyState === 'open') {
      this.unreliableDataChannel.close()
    } else {
      throw new Error(
        `unreliableDataChannel is defined but readyState is wrong ${this.unreliableDataChannel.readyState}`
      )
    }
  }

  disconnectPeerConnection() {
    if (!this.peerConnection) {
      throw new Error('peerConnection is undefined')
    }

    if (this.peerConnection.connectionState === 'connected') {
      this.peerConnection.close()
    } else {
      throw new Error(
        `peerConnection is defined but connectionState is wrong ${this.peerConnection.connectionState}`
      )
    }
  }

  removeAllEventListeners() {
    // Could hard code all the possible event keys and see if each one is removed.
    const listenersToRemove = Array.from(this.allEventListeners)

    listenersToRemove.forEach(
      ([event, eventListenerTracked]: [string, IEventListenerTracked]) => {
        const type = eventListenerTracked.type

        if (type === 'window') {
          window.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else if (type === 'peerConnection') {
          this.peerConnection?.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else if (type === 'websocket') {
          this.websocket?.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else if (type === 'unreliableDataChannel') {
          this.unreliableDataChannel?.removeEventListener(
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
  }

  cleanUpTimeouts() {
    clearTimeout(this.timeoutToForceConnectId)
    this.timeoutToForceConnectId = undefined
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

  // Do not change this back to an object or any, we should only be sending the
  // WebSocketRequest type!
  unreliableSend(message: Models['WebSocketResponse_type']) {
    if (!this.unreliableDataChannel) {
      throw new Error('race condition my guy, unreliableSend')
    }

    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.unreliableDataChannel?.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }

  send(message: Models['WebSocketRequest_type']) {
    if (!this.websocket) {
      throw new Error('send, websocket is undefined')
    }

    if (this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('websocket is not in a ready state')
    }

    // Not connected, don't send anything
    if (this.websocket?.readyState !== WebSocket.OPEN) return

    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.websocket?.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }
}
