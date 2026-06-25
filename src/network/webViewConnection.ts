import * as zoo from '@kittycad/lib'
import type {
  ClientMetrics,
  WebSocketRequest,
} from '@kittycad/lib/dist/types/src'
import { ZooWebView } from '@kittycad/web-view'
import { EngineDebugger } from '@src/lib/debugger'
import { markOnce } from '@src/lib/performance'
import { promiseFactory, uuidv4 } from '@src/lib/utils'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { createWebrtcStatsCollector } from '@src/network/peerConnection'
import type { IEventListenerTracked, ManagerTearDown } from '@src/network/utils'
import {
  ConnectingType,
  EngineConnectionEvents,
  EngineConnectionStateType,
} from '@src/network/utils'

interface IDeferredPromise {
  promise: Promise<any>
  resolve: (value: any) => void
  reject: (value: any) => void
}

type WebViewWorkerMessage =
  | {
      from: 'websocket'
      payload: {
        type: 'message'
        data: unknown
      }
    }
  | {
      from: 'wasm'
      payload: {
        type: 'message' | 'execute'
        data: unknown
      }
    }

const webViewKclWasmFileName = 'kittycad-web-view-kcl_wasm_lib_bg.wasm'
const webViewKclWasmUrlProperty = 'kcl_wasm_lib_bg_wasm_url'
const webViewWasmPatchSymbol = Symbol.for(
  'zoo-modeling-app.webViewKclWasmUrlPatch'
)

const webViewKclWasmUrl = () => {
  if (typeof document === 'undefined') {
    return `/${webViewKclWasmFileName}`
  }

  if (document.location.protocol.includes('http')) {
    return new URL(`/${webViewKclWasmFileName}`, document.location.origin).href
  }

  return new URL(webViewKclWasmFileName, document.location.href).href
}

const ensureWebViewKclWasmUrlPatch = () => {
  const prototype = zoo.WebRTC.prototype as typeof zoo.WebRTC.prototype & {
    [webViewWasmPatchSymbol]?: boolean
  }
  if (prototype[webViewWasmPatchSymbol]) {
    return
  }

  const originalStart = Reflect.get(prototype, 'start')
  prototype.start = function patchedStart(this: zoo.WebRTC) {
    const args = (
      this as unknown as { zooClientArgs?: Record<string, unknown> }
    ).zooClientArgs
    if (args) {
      args[webViewKclWasmUrlProperty] = webViewKclWasmUrl()
    }

    return originalStart.call(this)
  }
  prototype[webViewWasmPatchSymbol] = true
}

class WebViewWebSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING
  binaryType: BinaryType = 'arraybuffer'

  constructor(
    private readonly sendRaw: (
      data: string | ArrayBufferLike | Blob | ArrayBufferView
    ) => void
  ) {
    super()
  }

  open() {
    this.readyState = WebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== WebSocket.OPEN) {
      return
    }

    this.sendRaw(data)
  }

  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  close(code = 1000) {
    if (this.readyState === WebSocket.CLOSED) {
      return
    }

    this.readyState = WebSocket.CLOSED
    const event =
      typeof CloseEvent === 'function'
        ? new CloseEvent('close', { code })
        : Object.assign(new Event('close'), { code })
    this.dispatchEvent(event)
  }
}

export class WebViewConnection extends EventTarget {
  readonly id = uuidv4()
  readonly url = withAPIBaseURL('')
  private readonly token: string
  private readonly streamElement: HTMLElement
  private readonly requestedSize: { width: number; height: number }
  private readonly handleOnDataChannelMessage: (
    event: MessageEvent<any>
  ) => void
  private readonly tearDownManager: (options?: ManagerTearDown) => void
  private readonly rejectPendingCommand: ({ cmdId }: { cmdId: string }) => void

  private zooWebView: ZooWebView | undefined
  private rtc: zoo.WebRTC | undefined
  private removeWorkerMessageListener: (() => void) | undefined
  private removeDataChannelCloseListener: (() => void) | undefined

  peerConnection: RTCPeerConnection | undefined
  unreliableDataChannel: RTCDataChannel | undefined
  mediaStream: MediaStream | undefined
  websocket: WebSocket | undefined
  sdpAnswer: RTCSessionDescriptionInit | undefined

  deferredConnection: IDeferredPromise | null = null
  deferredPeerConnection: IDeferredPromise | null = null
  deferredMediaStreamAndWebrtcStatsCollector: IDeferredPromise | null = null
  deferredSdpAnswer: IDeferredPromise | null = null

  iceCandidatePromises: Promise<unknown>[] = []
  webrtcStatsCollector: (() => Promise<ClientMetrics>) | undefined
  allEventListeners = new Map<string, IEventListenerTracked>()
  timeoutToForceConnectId: ReturnType<typeof setTimeout> | undefined
  isUsingUnitTestingConnection = false
  connected = false

  constructor({
    width,
    height,
    token,
    streamElement,
    handleOnDataChannelMessage,
    tearDownManager,
    rejectPendingCommand,
  }: {
    width: number
    height: number
    token: string
    streamElement: HTMLElement
    handleOnDataChannelMessage: (event: MessageEvent<any>) => void
    tearDownManager: (options?: ManagerTearDown) => void
    rejectPendingCommand: ({ cmdId }: { cmdId: string }) => void
  }) {
    markOnce('code/startInitialEngineConnect')
    super()
    this.token = token
    this.streamElement = streamElement
    this.requestedSize = { width, height }
    this.handleOnDataChannelMessage = handleOnDataChannelMessage
    this.tearDownManager = tearDownManager
    this.rejectPendingCommand = rejectPendingCommand
  }

  get videoElement(): HTMLVideoElement | undefined {
    return (
      this.zooWebView?.el.querySelector<HTMLVideoElement>('video') ?? undefined
    )
  }

  async connect(): Promise<unknown> {
    EngineDebugger.addLog({
      label: 'webViewConnection',
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

    this.deferredConnection.promise.catch((e) => console.warn(e))
    this.deferredPeerConnection.promise.catch((e) => {
      console.warn(e)
      this.deferredConnection?.reject(e)
    })
    this.deferredMediaStreamAndWebrtcStatsCollector.promise.catch((e) => {
      console.warn(e)
      this.deferredConnection?.reject(e)
    })
    this.deferredSdpAnswer.promise.catch((e) => {
      console.warn(e)
      this.deferredConnection?.reject(e)
    })

    this.dispatchConnectionStep(ConnectingType.WebSocketConnecting)

    const fakeWebSocket = new WebViewWebSocket((data) => {
      this.rtc?.send(data)?.catch((error) => {
        EngineDebugger.addLog({
          label: 'webViewConnection',
          message: 'rtc.send failed',
          metadata: { error },
        })
      })
    })
    this.websocket = fakeWebSocket as unknown as WebSocket

    const zooClient = new zoo.Client({
      token: this.token,
      baseUrl: this.url,
    })
    ensureWebViewKclWasmUrlPatch()
    this.zooWebView = new ZooWebView({
      zooClient,
      size: this.requestedSize,
      allowMultiple: true,
      autoStart: false,
    })
    this.prepareElements()
    this.streamElement.insertBefore(
      this.zooWebView.el,
      this.streamElement.firstChild
    )

    const startElement =
      this.zooWebView.el.querySelector<HTMLElement>('div.start')
    if (!startElement) {
      return Promise.reject(
        new Error('ZooWebView start element was not created')
      )
    }

    startElement.click()

    this.rtc = this.zooWebView.rtc
    if (!this.rtc) {
      return Promise.reject(
        new Error('ZooWebView did not create a WebRTC session')
      )
    }

    this.rtc.removeMouseEvents()
    this.peerConnection = (
      this.rtc as unknown as { rtcPeerConnection?: RTCPeerConnection }
    ).rtcPeerConnection
    if (!this.peerConnection) {
      return Promise.reject(
        new Error('ZooWebView WebRTC peer connection is missing')
      )
    }

    const trackPromise = this.waitForTrack()
    const channelPromise = this.waitForDataChannel()
    const connectedPromise = this.waitForConnected()

    this.deferredPeerConnection.resolve(true)
    this.dispatchConnectionStep(ConnectingType.WebSocketOpen)
    this.dispatchConnectionStep(ConnectingType.PeerConnectionCreated)
    this.dispatchConnectionStep(
      ConnectingType.DataChannelRequested,
      'unreliable_modeling_cmds'
    )

    fakeWebSocket.open()
    this.bridgeWorkerMessages(fakeWebSocket)

    await Promise.all([trackPromise, channelPromise, connectedPromise])

    this.connected = true
    this.deferredConnection.resolve(true)
    this.dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.ConnectionEstablished,
        },
      })
    )
    markOnce('code/endInitialEngineConnect')

    return this.deferredConnection.promise
  }

  private waitForTrack() {
    return new Promise<void>((resolve) => {
      const onTrack = () => {
        if (!this.rtc?.track) {
          return
        }

        const mediaStream = this.rtc.track.streams[0]
        this.mediaStream = mediaStream
        if (this.peerConnection) {
          this.webrtcStatsCollector = createWebrtcStatsCollector({
            mediaStream,
            peerConnection: this.peerConnection,
          })
        }

        this.deferredMediaStreamAndWebrtcStatsCollector?.resolve(true)
        this.dispatchConnectionStep(ConnectingType.TrackReceived)
        this.dispatchEvent(
          new CustomEvent(EngineConnectionEvents.NewTrack, {
            detail: { conn: this, mediaStream },
          })
        )
        this.rtc.removeEventListener('track', onTrack)
        resolve()
      }

      this.rtc?.addEventListener('track', onTrack)
    })
  }

  private waitForDataChannel() {
    return new Promise<void>((resolve, reject) => {
      const onDataChannel = () => {
        const channel = this.rtc?.channel
        if (!channel) {
          return
        }

        this.unreliableDataChannel = channel
        channel.addEventListener('message', this.handleOnDataChannelMessage)
        this.dispatchConnectionStep(
          ConnectingType.DataChannelConnecting,
          channel.label
        )

        const onOpen = () => {
          channel.removeEventListener('open', onOpen)
          channel.removeEventListener('error', onError)
          channel.removeEventListener('close', onClose)
          const onRuntimeClose = () => {
            this.tearDownManager({ dataChannelClosed: true })
          }
          channel.addEventListener('close', onRuntimeClose)
          this.removeDataChannelCloseListener = () => {
            channel.removeEventListener('close', onRuntimeClose)
          }
          this.dispatchConnectionStep(ConnectingType.DataChannelEstablished)
          resolve()
        }
        const onError = (event: Event) => {
          reject(event)
        }
        const onClose = () => {
          this.tearDownManager({ dataChannelClosed: true })
          reject(new Error('ZooWebView data channel closed before opening'))
        }

        channel.addEventListener('open', onOpen)
        channel.addEventListener('error', onError)
        channel.addEventListener('close', onClose)

        if (channel.readyState === 'open') {
          onOpen()
        }

        this.rtc?.removeEventListener('datachannel', onDataChannel)
      }

      this.rtc?.addEventListener('datachannel', onDataChannel)
    })
  }

  private waitForConnected() {
    return new Promise<void>((resolve) => {
      const onConnected = () => {
        this.rtc?.removeResizeObserver()
        this.rtc?.removeEventListener('connected', onConnected)
        this.rtc?.removeEventListener('close', onClose)
        resolve()
      }

      const onClose = () => {
        this.rtc?.removeEventListener('close', onClose)
        this.tearDownManager({ peerConnectionDisconnected: true })
      }

      this.rtc?.addEventListener('connected', onConnected)
      this.rtc?.addEventListener('close', onClose)
    })
  }

  private bridgeWorkerMessages(fakeWebSocket: WebViewWebSocket) {
    const executor = this.rtc?.executor()
    if (!executor) {
      return
    }

    const onWorkerMessage = (event: MessageEvent<WebViewWorkerMessage>) => {
      const message = event.data
      if (
        !message ||
        !('from' in message) ||
        message.from !== 'websocket' ||
        message.payload.type !== 'message'
      ) {
        return
      }

      fakeWebSocket.receive(message.payload.data)
    }

    executor.addEventListener(onWorkerMessage)
    this.removeWorkerMessageListener = () => {
      executor.removeEventListener(onWorkerMessage)
    }
  }

  private prepareElements() {
    if (!this.zooWebView) {
      return
    }

    const { el } = this.zooWebView
    el.dataset.engineConnectionSource = 'zoo-web-view'
    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      backgroundColor: 'transparent',
      cursor: 'inherit',
    })

    const video = this.videoElement
    if (video) {
      video.id = 'video-stream'
      video.autoplay = true
      video.muted = true
      video.controls = false
      video.disablePictureInPicture = true
      Object.assign(video.style, {
        width: '100%',
        height: '100%',
        objectFit: 'fill',
        cursor: 'pointer',
      })
    }

    const startElement = el.querySelector<HTMLElement>('div.start')
    if (startElement) {
      startElement.style.display = 'none'
    }
  }

  private dispatchConnectionStep(type: ConnectingType, value?: string) {
    this.dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.Connecting,
          value:
            value === undefined
              ? { type }
              : {
                  type,
                  value,
                },
        },
      })
    )
  }

  startPingPong() {
    // WebView's worker owns its websocket lifecycle. Ping reporting can be
    // wired through the worker if @kittycad/web-view exposes that event.
  }

  stopPingPong() {
    // No-op; see startPingPong.
  }

  disconnectAll() {
    this.removeAllEventListeners()
    this.removeWorkerMessageListener?.()
    this.removeWorkerMessageListener = undefined
    this.removeDataChannelCloseListener?.()
    this.removeDataChannelCloseListener = undefined
    this.unreliableDataChannel?.removeEventListener(
      'message',
      this.handleOnDataChannelMessage
    )
    void this.zooWebView?.deconstructor()
    this.zooWebView?.el.remove()
    this.zooWebView = undefined
    this.rtc = undefined
    this.peerConnection = undefined
    this.unreliableDataChannel = undefined
    this.mediaStream = undefined
    this.webrtcStatsCollector = undefined
    this.connected = false
    this.websocket?.close()
  }

  removeAllEventListeners() {
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
        } else if (type === 'connection') {
          this.removeEventListener(
            eventListenerTracked.event,
            eventListenerTracked.callback
          )
        } else {
          console.warn(`untracked listener type ${type}`)
        }
      }
    )

    this.allEventListeners = new Map()
  }

  unreliableSend(message: WebSocketRequest) {
    if (!this.unreliableDataChannel) {
      console.warn('unable to send unreliable message, data channel is missing')
      return
    }

    if (this.unreliableDataChannel.readyState !== 'open') {
      console.warn(
        `unable to send unreliable message, data channel is ${this.unreliableDataChannel.readyState}`
      )
      return
    }

    this.unreliableDataChannel.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }

  send(message: WebSocketRequest) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      if (
        typeof message !== 'string' &&
        message.type === 'modeling_cmd_req' &&
        message.cmd &&
        message.cmd_id
      ) {
        this.rejectPendingCommand({ cmdId: message.cmd_id })
      }
      return
    }

    this.websocket.send(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
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

  setPong() {}
  setPing() {}
  setSdpAnswer(answer: RTCSessionDescriptionInit) {
    this.sdpAnswer = answer
  }
  setTimeoutToForceConnectId(id: ReturnType<typeof setTimeout>) {
    this.timeoutToForceConnectId = id
  }
  cleanUpTimeouts() {
    clearTimeout(this.timeoutToForceConnectId)
    this.timeoutToForceConnectId = undefined
  }

  addIceCandidate(candidate: RTCIceCandidateInit) {
    this.iceCandidatePromises.push(
      this.peerConnection?.addIceCandidate(candidate) ?? Promise.resolve()
    )
  }
}
