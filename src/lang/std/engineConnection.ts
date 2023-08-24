import { SourceRange } from 'lang/executor'
import { Selections } from 'useStore'
import { VITE_KC_API_WS_MODELING_URL, VITE_KC_CONNECTION_TIMEOUT_MS } from 'env'
import { Models } from '@kittycad/lib'
import { exportSave } from 'lib/exportSave'
import { v4 as uuidv4 } from 'uuid'

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

export type EngineCommand = Models['WebSocketMessages_type']

type OkResponse = Models['OkModelingCmdResponse_type']

type WebSocketResponse = Models['WebSocketResponses_type']

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

      if (event.data.toLocaleLowerCase().startsWith('error')) {
        console.error('something went wrong: ', event.data)
        return
      }

      const message: WebSocketResponse = JSON.parse(event.data)

      if (
        message.type === 'sdp_answer' &&
        message?.answer &&
        message?.answer?.type !== 'unspecified'
      ) {
        if (this.pc?.signalingState !== 'stable') {
          // If the connection is stable, we shouldn't bother updating the
          // SDP, since we have a stable connection to the backend. If we
          // need to renegotiate, the whole PeerConnection needs to get
          // tore down.
          this.pc?.setRemoteDescription(
            new RTCSessionDescription({
              type: message.answer.type,
              sdp: message.answer.sdp,
            })
          )
        }
      } else if (message.type === 'trickle_ice') {
        this.pc?.addIceCandidate(message.candidate as RTCIceCandidateInit)
      } else if (message.type === 'ice_server_info' && this.pc) {
        console.log('received ice_server_info')

        if (message?.ice_servers?.length > 0) {
          // When we set the Configuration, we want to always force
          // iceTransportPolicy to 'relay', since we know the topology
          // of the ICE/STUN/TUN server and the engine. We don't wish to
          // talk to the engine in any configuration /other/ than relay
          // from a infra POV.
          this.pc.setConfiguration({
            iceServers: message.ice_servers,
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
          if (event.candidate === null) {
            // console.log('sent sdp_offer')
            // this.send({
            //   type: 'sdp_offer',
            //   offer: this.pc.localDescription,
            // })
          } else {
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

        this.onDataChannelOpen(this)

        let timeToConnectMs = new Date().getTime() - connectionStarted.getTime()
        console.log(`engine connection time to connect: ${timeToConnectMs}ms`)
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
            const result: OkResponse = JSON.parse(event.data)
            if (
              result.type === 'highlight_set_entity' &&
              result.sequence &&
              result.sequence > this.inSequence
            ) {
              this.onHoverCallback(result.entity_id)
              this.inSequence = result.sequence
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
            if (event.data.toLocaleLowerCase().startsWith('error')) {
              // Errors are not JSON encoded; if we have an error we can bail
              // here; debugging the error to the console happens in the core
              // engine code.
              return
            }
            const message: WebSocketResponse = JSON.parse(event.data)
            if (message.type === 'modeling') {
              this.handleModelingCommand(message)
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
  handleModelingCommand(message: WebSocketResponse) {
    if (message.type !== 'modeling') {
      return
    }

    const id = message.cmd_id
    const command = this.artifactMap[id]
    if ('ok' in message.result) {
      const result: OkResponse = message.result.ok
      if (result.type === 'select_with_point') {
        if (result.entity_id) {
          this.onClickCallback({
            id: result.entity_id,
            type: 'default',
          })
        } else {
          this.onClickCallback()
        }
      }
    }
    if (command && command.type === 'pending') {
      const resolve = command.resolve
      this.artifactMap[id] = {
        type: 'result',
        data: message.result,
      }
      resolve({
        id,
      })
    } else {
      this.artifactMap[id] = {
        type: 'result',
        data: message.result,
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
  sendModelingCommandFromWasm({
    id,
    rangeStr,
    commandStr,
  }: {
    id: string
    rangeStr: string
    commandStr: string
  }): Promise<any> {
    if (id === undefined) {
      throw new Error('id is undefined')
    }
    if (rangeStr === undefined) {
      throw new Error('rangeStr is undefined')
    }
    if (commandStr === undefined) {
      throw new Error('commandStr is undefined')
    }
    console.log('sendModelingCommandFromWasm', id, rangeStr, commandStr)
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
