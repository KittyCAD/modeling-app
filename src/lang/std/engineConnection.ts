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

interface SelectionsArgs {
  id: string
  type: Selections['codeBasedSelections'][number]['type']
}

interface CursorSelectionsArgs {
  otherSelections: Selections['otherSelections']
  idBasedSelections: { type: string; id: string }[]
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
  lossyDataChannel?: RTCDataChannel

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
  // connect will attempt to connect to the Engine over a WebSocket, and
  // establish the WebRTC connections.
  //
  // This will attempt the full handshake, and retry if the connection
  // did not establish.
  connect() {
    // TODO(paultag): make this safe to call multiple times, and figure out
    // when a connection is in progress (state: connecting or something).

    // Information on the connect transaction
    const webrtcMediaTransaction = Sentry.startTransaction({ name: 'webrtc-media' })

    const websocketSpan = webrtcMediaTransaction.startChild({ op: "websocket" })
    let mediaTrackSpan: Sentry.Span
    let dataChannelSpan: Sentry.Span
    let handshakeSpan: Sentry.Span

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
      // websocketSpan.setStatus(SpanStatus.OK)
      websocketSpan.finish()

      handshakeSpan = webrtcMediaTransaction.startChild({ op: "handshake" })
      dataChannelSpan = webrtcMediaTransaction.startChild({ op: "data-channel" })
      mediaTrackSpan = webrtcMediaTransaction.startChild({ op: "media-track" })
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

          // When both ends have a local and remote SDP, we've been able to
          // set up successfully. We'll still need to find the right ICE
          // servers, but this is hand-shook.
          handshakeSpan.finish()
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
          // if (this.pc?.iceConnectionState === 'disconnected') {
          //   this.close()
          // }
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
      console.log('received track', event)
      const mediaStream = event.streams[0]

      mediaStream.getVideoTracks()[0].addEventListener('unmute', () => {
        mediaTrackSpan.finish()
        webrtcMediaTransaction.finish()
      })

      // Set up the background thread to keep an eye on statistical
      // information about the WebRTC media stream from the server to
      // us. We'll also eventually want more global statistical information,
      // but this will give us a baseline.
      if (parseInt(VITE_KC_CONNECTION_WEBRTC_REPORT_STATS_MS) !== 0) {
        setInterval(() => {
          if (this.pc === undefined) {
            return
          }

          console.log('Reporting statistics')

          // Use the WebRTC Statistics API to collect statistical information
          // about the WebRTC connection we're using to report to Sentry.
          mediaStream.getVideoTracks().forEach((videoTrack) => {
            let trackStats = new Map<string, any>()
            this.pc?.getStats(videoTrack).then((videoTrackStats) => {
              // Sentry only allows 10 metrics per transaction. We're going
              // to have to pick carefully here, eventually send like a prom
              // file or something to the peer.

              const transaction = Sentry.startTransaction({ name: 'webrtc-stats' })
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
              transaction.finish()
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
      this.lossyDataChannel = event.channel

      console.log('accepted lossy data channel', event.channel.label)
      this.lossyDataChannel.addEventListener('open', (event) => {
        console.log('lossy data channel opened', event)
        dataChannelSpan.finish()

        this.onDataChannelOpen(this)

        this.onEngineConnectionOpen(this)
        this.ready = true
      })

      this.lossyDataChannel.addEventListener('close', (event) => {
        console.log('lossy data channel closed')
        this.close()
      })

      this.lossyDataChannel.addEventListener('error', (event) => {
        console.log('lossy data channel error')
        this.close()
      })
    })

    this.onConnectionStarted(this)
  }
  send(message: object) {
    // TODO(paultag): Add in logic to determine the connection state and
    // take actions if needed?
    this.websocket?.send(JSON.stringify(message))
  }
  close() {
    this.websocket?.close()
    this.pc?.close()
    this.lossyDataChannel?.close()
    this.websocket = undefined
    this.pc = undefined
    this.lossyDataChannel = undefined

    this.onClose(this)
    this.ready = false
  }
}

export type EngineCommand = Models['WebSocketRequest_type']

export class EngineCommandManager {
  artifactMap: ArtifactMap = {}
  sourceRangeMap: SourceRangeMap = {}
  outSequence = 1
  inSequence = 1
  engineConnection?: EngineConnection
  waitForReady: Promise<void> = new Promise(() => {})
  private resolveReady = () => {}
  onHoverCallback: (id?: string) => void = () => {}
  onClickCallback: (selection?: SelectionsArgs) => void = () => {}
  onCursorsSelectedCallback: (selections: CursorSelectionsArgs) => void =
    () => {}
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
          let lossyDataChannel = event.channel

          lossyDataChannel.addEventListener('message', (event) => {
            const result: Models['OkModelingCmdResponse_type'] = JSON.parse(
              event.data
            )
            if (
              result.type === 'highlight_set_entity' &&
              result?.data?.sequence &&
              result.data.sequence > this.inSequence
            ) {
              this.onHoverCallback(result.data.entity_id)
              this.inSequence = result.data.sequence
            }
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

    const command = this.artifactMap[id]
    if (modelingResponse.type === 'select_with_point') {
      if (modelingResponse?.data?.entity_id) {
        this.onClickCallback({
          id: modelingResponse?.data?.entity_id,
          type: 'default',
        })
      } else {
        this.onClickCallback()
      }
    }
    if (command && command.type === 'pending') {
      const resolve = command.resolve
      this.artifactMap[id] = {
        type: 'result',
        data: modelingResponse,
      }
      resolve({
        id,
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
  endSession() {
    // this.websocket?.close()
    // socket.off('command')
  }
  onHover(callback: (id?: string) => void) {
    // It's when the user hovers over a part in the 3d scene, and so the engine should tell the
    // frontend about that (with it's id) so that the FE can highlight code associated with that id
    this.onHoverCallback = callback
  }
  onClick(callback: (selection?: SelectionsArgs) => void) {
    // It's when the user clicks on a part in the 3d scene, and so the engine should tell the
    // frontend about that (with it's id) so that the FE can put the user's cursor on the right
    // line of code
    this.onClickCallback = callback
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
  sendSceneCommand(command: EngineCommand) {
    if (!this.engineConnection?.isReady()) {
      console.log('socket not ready')
      return
    }
    if (command.type !== 'modeling_cmd_req') return
    const cmd = command.cmd
    if (
      cmd.type === 'camera_drag_move' &&
      this.engineConnection?.lossyDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.lossyDataChannel?.send(JSON.stringify(command))
      return
    } else if (
      cmd.type === 'highlight_set_entity' &&
      this.engineConnection?.lossyDataChannel
    ) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.engineConnection?.lossyDataChannel?.send(JSON.stringify(command))
      return
    }
    console.log('sending command', command)
    this.engineConnection?.send(command)
  }
  sendModelingCommand({
    id,
    range,
    command,
  }: {
    id: string
    range: SourceRange
    command: EngineCommand
  }): Promise<any> {
    this.sourceRangeMap[id] = range

    if (!this.engineConnection?.isReady()) {
      console.log('socket not ready')
      return new Promise(() => {})
    }
    this.engineConnection?.send(command)
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
    const command: EngineCommand = JSON.parse(commandStr)
    const range: SourceRange = JSON.parse(rangeStr)

    return this.sendModelingCommand({ id, range, command })
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
