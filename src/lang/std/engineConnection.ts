import { SourceRange } from '../executor'
import { Selections } from '../../useStore'
import { VITE_KC_API_WS_MODELING_URL } from '../../env'
import { Models } from '@kittycad/lib'
import { exportSave } from '../../lib/exportSave'
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

  onConnectionStarted: (conn: EngineConnection) => void = () => {}

  waitForReady: Promise<void> = new Promise(() => {})
  private resolveReady = () => {}

  readonly url: string
  private readonly token?: string

  constructor({
    url,
    token,
    onConnectionStarted,
  }: {
    url: string
    token?: string
    onConnectionStarted: (conn: EngineConnection) => void
  }) {
    this.url = url
    this.token = token
    this.onConnectionStarted = onConnectionStarted

    // TODO(paultag): This isn't right; this should be when the
    // connection is in a good place, and tied to the connect() method,
    // but this is part of a larger refactor to untangle logic. Once the
    // Connection is pulled apart, we can rework how ready is represented.
    // This was just the easiest way to ensure some level of parity between
    // the CommandManager and the Connection until I send a rework for
    // retry logic.
    this.waitForReady = new Promise((resolve) => {
      this.resolveReady = resolve
    })
  }

  connect() {
    this.websocket = new WebSocket(this.url, [])

    this.websocket.binaryType = 'arraybuffer'

    this.pc = new RTCPeerConnection()
    this.pc.createDataChannel('unreliable_modeling_cmds')
    this.websocket.addEventListener('open', (event) => {
      console.log('Connected to websocket, waiting for ICE servers')
      if (this.token) {
        this.websocket?.send(
          JSON.stringify({ headers: { Authorization: `Bearer ${this.token}` } })
        )
      }
    })

    this.websocket.addEventListener('close', (event) => {
      console.log('websocket connection closed', event)
    })

    this.websocket.addEventListener('error', (event) => {
      console.log('websocket connection error', event)
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

      const message: WebSocketResponse = JSON.parse(event.data)

      if (
        message.type === 'sdp_answer' &&
        message.answer.type !== 'unspecified'
      ) {
        this.pc?.setRemoteDescription(
          new RTCSessionDescription({
            type: message.answer.type,
            sdp: message.answer.sdp,
          })
        )
      } else if (message.type === 'trickle_ice') {
        this.pc?.addIceCandidate(message.candidate as RTCIceCandidateInit)
      } else if (message.type === 'ice_server_info' && this.pc) {
        console.log('received ice_server_info')

        if (message.ice_servers.length > 0) {
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

        this.pc.addEventListener('connectionstatechange', (e) =>
          console.log(this.pc?.iceConnectionState)
        )

        this.pc.addEventListener('icecandidate', (event) => {
          if (!this.pc || !this.websocket) return
          if (event.candidate === null) {
            console.log('sent sdp_offer')
            this.websocket.send(
              JSON.stringify({
                type: 'sdp_offer',
                offer: this.pc.localDescription,
              })
            )
          } else {
            console.log('sending trickle ice candidate')
            const { candidate } = event
            this.websocket?.send(
              JSON.stringify({
                type: 'trickle_ice',
                candidate: candidate.toJSON(),
              })
            )
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
            const msg = JSON.stringify({
              type: 'sdp_offer',
              offer: this.pc?.localDescription,
            })
            this.websocket?.send(msg)
          })
          .catch(console.log)
      }
    })

    this.pc.addEventListener('datachannel', (event) => {
      this.lossyDataChannel = event.channel

      console.log('accepted lossy data channel', event.channel.label)
      this.lossyDataChannel.addEventListener('open', (event) => {
        this.resolveReady()
        console.log('lossy data channel opened', event)
      })

      this.lossyDataChannel.addEventListener('close', (event) => {
        console.log('lossy data channel closed')
      })

      this.lossyDataChannel.addEventListener('error', (event) => {
        console.log('lossy data channel error')
      })
    })

    if (this.onConnectionStarted) this.onConnectionStarted(this)
  }
  close() {
    this.websocket?.close()
    this.pc?.close()
    this.lossyDataChannel?.close()
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
      onConnectionStarted: (conn) => {
        this.engineConnection?.pc?.addEventListener('track', (event) => {
          console.log('received track', event)
          const mediaStream = event.streams[0]
          setMediaStream(mediaStream)
        })

        this.engineConnection?.pc?.addEventListener('datachannel', (event) => {
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
        conn.websocket?.addEventListener('message', (event) => {
          if (event.data instanceof ArrayBuffer) {
            // If the data is an ArrayBuffer, it's  the result of an export command,
            // because in all other cases we send JSON strings. But in the case of
            // export we send a binary blob.
            // Pass this to our export function.
            exportSave(event.data)
          } else if (
            typeof event.data === 'string' &&
            event.data.toLocaleLowerCase().startsWith('error')
          ) {
            console.warn('something went wrong: ', event.data)
          } else {
            const message: WebSocketResponse = JSON.parse(event.data)

            if (message.type === 'modeling') {
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
          }
        })
      },
    })

    // TODO(paultag): this isn't quite right, and the double promises is
    // pretty grim.
    this.engineConnection?.waitForReady.then(this.resolveReady)

    this.waitForReady.then(() => {
      setIsStreamReady(true)
    })

    this.engineConnection?.connect()
  }
  tearDown() {
    // close all channels, sockets and WebRTC connections
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
    // TODO talk to the gang about this
    // It's when the user clicks on a part in the 3d scene, and so the engine should tell the
    // frontend about that (with it's id) so that the FE can put the user's cursor on the right
    // line of code
    this.onClickCallback = callback
  }
  cusorsSelected(selections: {
    otherSelections: Selections['otherSelections']
    idBasedSelections: { type: string; id: string }[]
  }) {
    if (this.engineConnection?.websocket?.readyState === 0) {
      console.log('socket not open')
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
    if (this.engineConnection?.websocket?.readyState === 0) {
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
    this.engineConnection?.websocket?.send(JSON.stringify(command))
  }
  sendModellingCommand({
    id,
    params,
    range,
    command,
  }: {
    id: string
    params: any
    range: SourceRange
    command: EngineCommand
  }): Promise<any> {
    this.sourceRangeMap[id] = range

    if (this.engineConnection?.websocket?.readyState === 0) {
      console.log('socket not ready')
      return new Promise(() => {})
    }
    this.engineConnection?.websocket?.send(JSON.stringify(command))
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
