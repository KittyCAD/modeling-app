import { markOnce } from '@src/lib/performance'
import type { IEventListenerTracked, ManagerTearDown } from '@src/network/utils'
import {
  ConnectingType,
  DATACHANNEL_NAME_UMC,
  EngineConnectionEvents,
  EngineConnectionStateType,
  PING_INTERVAL_MS,
  WebSocketStatusCodes,
} from '@src/network/utils'
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
} from '@src/network/peerConnection'
import {
  createOnWebSocketClose,
  createOnWebSocketError,
  createOnWebSocketMessage,
  createOnWebSocketOpen,
} from '@src/network/websocketConnection'
import { EngineDebugger } from '@src/lib/debugger'
import { promiseFactory, uuidv4 } from '@src/lib/utils'
import { withWebSocketURL } from '@src/lib/withBaseURL'
import type {
  WebSocketRequest,
  WebSocketResponse,
  ClientMetrics,
} from '@kittycad/lib/dist/types/src'

// An interface for a promise that needs to be awaited and pass the resolve reject to
// other dependencies. We do not need to pass values between these. It is mainly
// to know did it pass or fail, not what the result is?
// A specific case from the promiseFactoy<T>() call
interface IDeferredPromise {
  promise: Promise<any>
  resolve: (value: any) => void
  reject: (value: any) => void
}

export class Connection extends EventTarget {
  // connection url for the new Websocket()
  readonly url: string
  // Authorization bearer token for headers on websocket
  private readonly _token: string | undefined
  private _pingPongSpan: {
    ping: number | undefined
    pong: number | undefined
  }
  private _pingIntervalId: ReturnType<typeof setInterval> | undefined
  timeoutToForceConnectId: ReturnType<typeof setTimeout> | undefined

  peerConnection: RTCPeerConnection | undefined
  unreliableDataChannel: RTCDataChannel | undefined
  mediaStream: MediaStream | undefined
  websocket: WebSocket | undefined
  sdpAnswer: RTCSessionDescriptionInit | undefined

  // Promises to write sync code and await the multiple levels of
  // initialization across Websocket -> peerConnection and their event handler
  deferredConnection: IDeferredPromise | null
  deferredPeerConnection: IDeferredPromise | null
  deferredMediaStreamAndWebrtcStatsCollector: IDeferredPromise | null
  deferredSdpAnswer: IDeferredPromise | null

  iceCandidatePromises: Promise<unknown>[]

  // Initialized from peerConnection onTrack event
  public webrtcStatsCollector: (() => Promise<ClientMetrics>) | undefined

  // Any event listener into this map to be cleaned up later
  // helps avoids duplicates as well
  allEventListeners: Map<string, IEventListenerTracked>

  // We spam initiateConnectionExclusive but we only need it to connect once
  // future calls will be rejected.
  exclusiveConnection: boolean

  // Used for EngineDebugger to know what instance of the class is tracked
  id: string

  // Unit testing requirements
  isUsingUnitTestingConnection: boolean = false

  // callback functions
  handleOnDataChannelMessage: (event: MessageEvent<any>) => void
  tearDownManager: (options?: ManagerTearDown) => void
  rejectPendingCommand: ({ cmdId }: { cmdId: string }) => void
  handleMessage: ((event: MessageEvent<any>) => void) | null

  constructor({
    url,
    token,
    handleOnDataChannelMessage,
    tearDownManager,
    rejectPendingCommand,
    callbackOnUnitTestingConnection,
    handleMessage,
  }: {
    url: string
    token: string
    handleOnDataChannelMessage: (event: MessageEvent<any>) => void
    tearDownManager: (options?: ManagerTearDown) => void
    rejectPendingCommand: ({ cmdId }: { cmdId: string }) => void
    callbackOnUnitTestingConnection?: () => void
    handleMessage: (event: MessageEvent<any>) => void
  }) {
    markOnce('code/startInitialEngineConnect')
    super()
    this.id = uuidv4()
    EngineDebugger.addLog({
      label: 'connection',
      message: 'constructor start',
      metadata: { id: this.id },
    })
    this.url = url
    this._token = token
    this.handleOnDataChannelMessage = handleOnDataChannelMessage
    this.tearDownManager = tearDownManager
    this.rejectPendingCommand = rejectPendingCommand
    this.handleMessage = handleMessage
    this._pingPongSpan = { ping: undefined, pong: undefined }
    this.deferredConnection = null
    this.deferredPeerConnection = null
    this.deferredMediaStreamAndWebrtcStatsCollector = null
    this.deferredSdpAnswer = null

    this.iceCandidatePromises = []
    this.allEventListeners = new Map()
    // No connection has been made when the class is initialized
    this.exclusiveConnection = false
    EngineDebugger.addLog({
      label: 'connection',
      message: 'constructor end',
      metadata: { id: this.id },
    })

    if (callbackOnUnitTestingConnection) {
      this.connectUnitTesting(callbackOnUnitTestingConnection)
      this.isUsingUnitTestingConnection = true
    }
  }

  connectUnitTesting(callback: () => void) {
    const url = withWebSocketURL(
      `?video_res_width=${256}&video_res_height=${256}`
    )
    this.websocket = new WebSocket(url, [])
    this.websocket.binaryType = 'arraybuffer'
    const onWebSocketOpen = (event: Event) => {
      this.send({
        type: 'headers',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      })
      this.deferredMediaStreamAndWebrtcStatsCollector?.resolve(true)
      this.deferredPeerConnection?.resolve(true)
      this.deferredSdpAnswer?.resolve(true)
      this.deferredConnection?.resolve(true)
    }
    this.websocket.addEventListener('open', onWebSocketOpen)
    this.websocket.addEventListener('message', ((event: MessageEvent) => {
      const message: WebSocketResponse = JSON.parse(event.data)
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
      if (!this.handleMessage) {
        console.warn('unable to process message, handleMessage is missing')
        return
      }
      this.handleMessage(event)
    }) as EventListener)
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

  /**
   * Starts when onDataChannelOpen is ready in the peerConnection
   */
  startPingPong() {
    EngineDebugger.addLog({
      label: 'connection',
      message: 'startPingPong',
      metadata: { id: this.id },
    })

    if (this._pingIntervalId) {
      console.warn('Attempting to startPingPong before stopping it.')
      return
    }

    this._pingIntervalId = setInterval(() => {
      if (this._pingPongSpan.ping) {
        return
      }

      this.send({ type: 'ping' })
      this._pingPongSpan = {
        ping: Date.now(),
        pong: undefined,
      }
    }, PING_INTERVAL_MS)
  }

  stopPingPong() {
    EngineDebugger.addLog({
      label: 'connection',
      message: 'stopPingPong',
      metadata: {
        id: this.id,
        startPingPongNeverCalled: this._pingIntervalId === undefined,
      },
    })
    clearInterval(this._pingIntervalId)
    this._pingIntervalId = undefined
  }

  /**
   * Don't call this function twice. Call disconnectAll() and make a new instance.
   */
  async connect(): Promise<unknown> {
    EngineDebugger.addLog({
      label: 'connection',
      message: 'connect',
      metadata: { id: this.id },
    })

    if (this.deferredConnection) {
      return Promise.reject('currently connecting, try again later.')
    }

    this.deferredConnection = promiseFactory<any>()
    this.deferredPeerConnection = promiseFactory<any>()
    this.deferredMediaStreamAndWebrtcStatsCollector = promiseFactory<any>()
    this.deferredSdpAnswer = promiseFactory<any>()

    const warnAndRejectConnect = (e: any) => {
      console.warn(e)
      this.deferredConnection?.reject(e)
    }

    // Make sure to catch all of these.
    this.deferredConnection.promise.catch((e) => {
      console.warn(e)
    })
    this.deferredPeerConnection.promise.catch(warnAndRejectConnect)
    this.deferredMediaStreamAndWebrtcStatsCollector.promise.catch(
      warnAndRejectConnect
    )
    this.deferredSdpAnswer.promise.catch(warnAndRejectConnect)

    this.createWebSocketConnection()

    await Promise.all([
      this.deferredPeerConnection.promise,
      this.deferredMediaStreamAndWebrtcStatsCollector.promise,
      this.deferredSdpAnswer.promise,
    ])

    // Gotcha: tricky to await initiateConnectionExclusive, there are multiple locations for firing?
    return this.deferredConnection.promise
  }

  /**
   * This is only metadata overhead to keep track of all the event listeners which allows for easy
   * removal during cleanUp. It can help prevent multiple runtime initializations of events.
   * name does not need to be eventListenerTracked.event, it is a unique human readable one to prevent collisions on
   * two different real event listeners
   * e.g. What is websocket has 'open' and peerConnection has 'open'. You do want two 'open' events but not on the same class
   * the name allows you to do websocket-open and peerConnection-open instead.
   */
  trackListener(name: string, eventListenerTracked: IEventListenerTracked) {
    if (this.allEventListeners.has(name)) {
      console.warn(
        `You are trying to track something twice, good luck! you're crashing: ${name}. This is actually bad.`
      )
      return
    }

    this.allEventListeners.set(name, eventListenerTracked)
  }

  /**
   * This function will be called many times from different sources depending on when those sources are fired.
   * The original sources can be fired in different orders depending on browsers.
   * We only want to get into the business logic once so we have an exclusiveConnection boolean.
   *
   * A peerConnection and sdpAnswer are required
   */
  async initiateConnectionExclusive() {
    if (!this.peerConnection) {
      return Promise.reject(new Error('peerConnection is undefined'))
    }

    if (!this.sdpAnswer) {
      EngineDebugger.addLog({
        label: 'connection',
        message: 'dropping initiateConnectionExclusive, sdpAnswer is undefined',
        metadata: { id: this.id },
      })
      return
    }

    if (this.exclusiveConnection) {
      EngineDebugger.addLog({
        label: 'connection',
        message: 'dropping initiateConnectionExclusive, it has already started',
        metadata: { id: this.id },
      })
      return
    }

    this.exclusiveConnection = true

    try {
      EngineDebugger.addLog({
        label: 'connection',
        message: 'initiateConnectionExclusive',
        metadata: { id: this.id },
      })
      this.dispatchEvent(
        new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
          detail: {
            type: EngineConnectionStateType.Connecting,
            value: {
              type: ConnectingType.WebRTCConnecting,
            },
          },
        })
      )
      await this.peerConnection.setRemoteDescription(this.sdpAnswer)
      EngineDebugger.addLog({
        label: 'connection',
        message: 'setRemoteDescription',
        metadata: { id: this.id },
      })
      this.dispatchEvent(
        new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
          detail: {
            type: EngineConnectionStateType.Connecting,
            value: {
              type: ConnectingType.SetRemoteDescription,
            },
          },
        })
      )
      this.cleanUpTimeouts()
    } catch (error) {
      console.warn('Failed to set remote description:', error)
      this.disconnectAll()
    }
  }

  createPeerConnection() {
    if (!this.deferredPeerConnection?.resolve) {
      console.warn('deferredPeerConnection resolve is undefined')
      return
    }

    if (!this.deferredConnection?.resolve) {
      console.warn('deferredConnection resolve is undefined')
      return
    }

    if (!this.deferredMediaStreamAndWebrtcStatsCollector?.resolve) {
      console.warn(
        'deferredMediaStreamAndWebrtcStatsCollector resolve is undefined'
      )
      return
    }

    this.peerConnection = new RTCPeerConnection({
      bundlePolicy: 'max-bundle',
    })

    this.dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.PeerConnectionCreated,
          },
        },
      })
    )

    EngineDebugger.addLog({
      label: 'connection',
      message: 'RTCPeerConnection',
      metadata: { id: this.id },
    })
    this.peerConnection.createDataChannel(DATACHANNEL_NAME_UMC)
    this.deferredPeerConnection.resolve(true)

    this.dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.DataChannelRequested,
            value: DATACHANNEL_NAME_UMC,
          },
        },
      })
    )

    EngineDebugger.addLog({
      label: 'connection',
      message: 'createDataChannel',
      metadata: { id: this.id },
    })

    const onIceCandidate = createOnIceCandidate({
      initiateConnectionExclusive: this.initiateConnectionExclusive.bind(this),
      send: this.send.bind(this),
      setTimeoutToForceConnectId: this.setTimeoutToForceConnectId.bind(this),
      dispatchEvent: this.dispatchEvent.bind(this),
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
      tearDownManager: this.tearDownManager.bind(this),
    })
    const onTrack = createOnTrack({
      setMediaStream: this.setMediaStream.bind(this),
      setWebrtcStatsCollector: this.setWebrtcStatsCollector.bind(this),
      peerConnection: this.peerConnection,
      deferredMediaStreamAndWebrtcStatsCollectorResolve:
        this.deferredMediaStreamAndWebrtcStatsCollector.resolve,
      dispatchEvent: this.dispatchEvent.bind(this),
    })

    // Has a callback workflow that will create a unreliabledatachannel
    const onDataChannel = createOnDataChannel({
      setUnreliableDataChannel: this.setUnreliableDataChannel.bind(this),
      dispatchEvent: this.dispatchEvent.bind(this),
      trackListener: this.trackListener.bind(this),
      startPingPong: this.startPingPong.bind(this),
      connectionPromiseResolve: this.deferredConnection.resolve,
      // don't bind this, it was passed into the class
      handleOnDataChannelMessage: this.handleOnDataChannelMessage,
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

    return this.peerConnection
  }

  createWebSocketConnection() {
    if (!this.deferredSdpAnswer?.resolve) {
      console.warn('deferredSdpAnswer resolve is undefined')
      return
    }

    EngineDebugger.addLog({
      label: 'connection',
      message: 'createWebSocketConnection',
      metadata: { id: this.id },
    })
    // A websocket that cannot connect due to failed: Error in connection establishment: net::ERR_INTERNET_DISCONNECTED
    // will not throw an error. Check in sync time if the websocket instance is closed
    this.websocket = new WebSocket(this.url, [])
    this.websocket.binaryType = 'arraybuffer'

    const onWebSocketOpen = createOnWebSocketOpen({
      send: this.send.bind(this),
      token: this.token,
      dispatchEvent: this.dispatchEvent.bind(this),
    })
    const onWebSocketError = createOnWebSocketError()
    const onWebSocketMessage = createOnWebSocketMessage({
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
      sdpAnswerResolve: this.deferredSdpAnswer.resolve,
      sdpAnswerReject: this.deferredSdpAnswer.reject,
    })
    const onWebSocketClose = createOnWebSocketClose({
      websocket: this.websocket,
      onWebSocketOpen: onWebSocketOpen,
      onWebSocketError: onWebSocketError,
      onWebSocketMessage: onWebSocketMessage,
      tearDownManager: this.tearDownManager.bind(this),
      dispatchEvent: this.dispatchEvent.bind(this),
    })

    // Meta close will remove all the internal events itself but then the this.websocket.close
    // needs to remove itself so it is wrapped in a metaClose.
    const metaClose = (event: CloseEvent) => {
      const codeAsString = event.code.toString()
      EngineDebugger.addLog({
        label: 'connection',
        message: 'metaClose',
        metadata: {
          event,
          codeSummarized: WebSocketStatusCodes[codeAsString] || codeAsString,
        },
      })
      onWebSocketClose(event)
    }

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
    EngineDebugger.addLog({
      label: 'connection',
      message: 'setMediaStream',
      metadata: { id: this.id },
    })
    this.mediaStream = mediaStream
  }

  setWebrtcStatsCollector(webrtcStatsCollector: () => Promise<ClientMetrics>) {
    EngineDebugger.addLog({
      label: 'connection',
      message: 'setWebrtcStatsCollector',
      metadata: { id: this.id },
    })
    this.webrtcStatsCollector = webrtcStatsCollector
  }

  setUnreliableDataChannel(channel: RTCDataChannel) {
    EngineDebugger.addLog({
      label: 'connection',
      message: 'setUnreliableDataChannel',
      metadata: { id: this.id },
    })
    this.unreliableDataChannel = channel
  }

  setPong(pong: number) {
    this._pingPongSpan.pong = pong
  }

  setPing(ping: number | undefined) {
    this._pingPongSpan.ping = ping
  }

  setSdpAnswer(answer: RTCSessionDescriptionInit) {
    EngineDebugger.addLog({
      label: 'connection',
      message: 'setSdpAnswer',
      metadata: { id: this.id },
    })
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
    this.stopPingPong()

    EngineDebugger.addLog({
      label: 'connection',
      message:
        'cleaned up websocket, unreliable data channel, and peer connection, all event listeners removed',
      metadata: { id: this.id },
    })
  }

  disconnectWebsocket() {
    if (!this.websocket) {
      console.warn('websocket is undefined unable to disconnect')
      return
    }

    if (this.websocket.readyState < WebSocket.CLOSED) {
      EngineDebugger.addLog({
        label: 'connection',
        message: 'disconnectWebsocket',
        metadata: { id: this.id },
      })
      this.websocket.close()
    } else if (this.websocket.readyState === WebSocket.CLOSED) {
      // no op it is already closed
      EngineDebugger.addLog({
        label: 'connection',
        message: 'websocket is already closed, do not need to call close()',
        metadata: { id: this.id },
      })
    } else {
      console.warn(
        `websocket is defined but readyState is wrong ${this.websocket.readyState}`
      )
    }
  }

  disconnectUnreliableDataChannel() {
    if (!this.unreliableDataChannel) {
      EngineDebugger.addLog({
        label: 'connection',
        message:
          'disconnectUnreliableDataChannel: unreliableDataChannel is undefined',
        metadata: { id: this.id },
      })
      return
    }

    if (this.unreliableDataChannel.readyState !== 'closed') {
      EngineDebugger.addLog({
        label: 'connection',
        message: 'disconnectUnreliableDataChannel',
        metadata: { id: this.id },
      })
      this.unreliableDataChannel.close()
    } else {
      EngineDebugger.addLog({
        label: 'connection',
        message: 'disconnectUnreliableDataChannel',
        metadata: {
          id: this.id,
          readyState: this.unreliableDataChannel.readyState,
        },
      })
    }
  }

  disconnectPeerConnection() {
    if (!this.peerConnection) {
      console.warn('peerConnection is undefined during disconnectPeerConnection')
      return
    }

    if (this.peerConnection.connectionState === 'closed') {
      EngineDebugger.addLog({
        label: 'connection',
        message: 'disconnectPeerConnection',
        metadata: { id: this.id },
      })
      this.peerConnection.close()
    } else {
      EngineDebugger.addLog({
        label: 'connection',
        message: 'disconnectPeerConnection',
        metadata: {
          id: this.id,
          connectionState: this.peerConnection.connectionState,
        },
      })
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
          console.warn(`untracked listener type ${type}`)
        }
      }
    )

    // Remove all references to the event listeners they are already removed.
    this.allEventListeners = new Map()
    EngineDebugger.addLog({
      label: 'connection',
      message: 'removeAllEventListeners',
      metadata: { id: this.id },
    })
  }

  cleanUpTimeouts() {
    clearTimeout(this.timeoutToForceConnectId)
    this.timeoutToForceConnectId = undefined
  }

  addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection) {
      console.warn('do not do this, crashing!')
      return
    }

    const tracker = new Promise<boolean>((resolve, reject) => {
      this.peerConnection
        ?.addIceCandidate(candidate)
        .then(() => {
          resolve(true)
        })
        .catch((e) => {
          reject(e)
        })
    })
    this.iceCandidatePromises.push(tracker)
    EngineDebugger.addLog({
      label: 'connection',
      message: 'addIceCandidate',
      metadata: { id: this.id },
    })
  }

  // Do not change this back to an object or any, we should only be sending the
  // WebSocketRequest type!
  unreliableSend(message: WebSocketRequest) {
    if (!this.unreliableDataChannel) {
      console.warn('race condition my guy, unreliableSend')
      return
    }

    if (this.unreliableDataChannel.readyState === 'connecting') {
      console.warn('sending message while unreliableDataChannel is connecting')
      return
    }

    if (this.unreliableDataChannel.readyState === 'closing') {
      console.warn('sending message while unreliableDataChannel is closing')
      return
    }

    if (this.unreliableDataChannel.readyState === 'closed') {
      console.warn('unreliableDataChannel is closed, rejecting the send.')
      return
    }

    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.unreliableDataChannel?.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }

  send(message: WebSocketRequest) {
    if (!this.websocket) {
      console.warn('send, websocket is undefined')
      return
    }

    // Not connected, don't send anything
    if (this.websocket.readyState !== WebSocket.OPEN) {
      EngineDebugger.addLog({
        label: 'websocket',
        message: 'readyState is not WebSocket.OPEN',
        metadata: { id: this.id, readyState: this.websocket?.readyState },
      })
      // If the command has an id, reject it!
      if (
        message.type === 'modeling_cmd_req' &&
        message.cmd &&
        message.cmd_id
      ) {
        this.rejectPendingCommand({ cmdId: message.cmd_id })
      }
      return
    }

    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.websocket?.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }
}
