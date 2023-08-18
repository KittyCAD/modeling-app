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

export class EngineCommandManager {
  artifactMap: ArtifactMap = {}
  sourceRangeMap: SourceRangeMap = {}
  outSequence = 1
  inSequence = 1
  socket?: WebSocket
  pc?: RTCPeerConnection
  lossyDataChannel?: RTCDataChannel
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
    this.socket = new WebSocket(url, [])

    // Change binary type from "blob" to "arraybuffer"
    this.socket.binaryType = 'arraybuffer'

    this.pc = new RTCPeerConnection()
    this.pc.createDataChannel('unreliable_modeling_cmds')
    this.socket.addEventListener('open', (event) => {
      console.log('Connected to websocket, waiting for ICE servers')
      if (token) {
        this.socket?.send(
          JSON.stringify({ headers: { Authorization: `Bearer ${token}` } })
        )
      }
    })

    this.socket.addEventListener('close', (event) => {
      console.log('websocket connection closed', event)
    })

    this.socket.addEventListener('error', (event) => {
      console.log('websocket connection error', event)
    })

    this?.socket?.addEventListener('message', (event) => {
      if (!this.socket || !this.pc) return

      // console.log('Message from server ', event.data);
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
            this.pc?.setConfiguration({
              iceServers: message.ice_servers,
              iceTransportPolicy: 'relay',
            })
          } else {
            this.pc?.setConfiguration({})
          }
          this.pc.addEventListener('track', (event) => {
            console.log('received track', event)
            const mediaStream = event.streams[0]
            setMediaStream(mediaStream)
          })

          this.pc.addEventListener('connectionstatechange', (e) =>
            console.log(this?.pc?.iceConnectionState)
          )
          this.pc.addEventListener('icecandidate', (event) => {
            if (!this.pc || !this.socket) return
            if (event.candidate === null) {
              console.log('sent sdp_offer')
              this.socket.send(
                JSON.stringify({
                  type: 'sdp_offer',
                  offer: this.pc.localDescription,
                })
              )
            } else {
              console.log('sending trickle ice candidate')
              const { candidate } = event
              this.socket?.send(
                JSON.stringify({
                  type: 'trickle_ice',
                  candidate: candidate.toJSON(),
                })
              )
            }
          })

          // Offer to receive 1 video track
          this.pc.addTransceiver('video', {
            direction: 'sendrecv',
          })
          this.pc
            .createOffer()
            .then(async (descriptionInit) => {
              await this?.pc?.setLocalDescription(descriptionInit)
              console.log('sent sdp_offer begin')
              const msg = JSON.stringify({
                type: 'sdp_offer',
                offer: this.pc?.localDescription,
              })
              this.socket?.send(msg)
            })
            .catch(console.log)

          this.pc.addEventListener('datachannel', (event) => {
            this.lossyDataChannel = event.channel
            console.log('accepted lossy data channel', event.channel.label)
            this.lossyDataChannel.addEventListener('open', (event) => {
              setIsStreamReady(true)
              this.resolveReady()
              console.log('lossy data channel opened', event)
            })
            this.lossyDataChannel.addEventListener('close', (event) => {
              console.log('lossy data channel closed')
            })
            this.lossyDataChannel.addEventListener('error', (event) => {
              console.log('lossy data channel error')
            })
            this.lossyDataChannel.addEventListener('message', (event) => {
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
        } else if (message.type === 'modeling') {
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
  }
  tearDown() {
    // close all channels, sockets and WebRTC connections
    this.lossyDataChannel?.close()
    this.socket?.close()
    this.pc?.close()
  }

  startNewSession() {
    this.artifactMap = {}
    this.sourceRangeMap = {}
  }
  endSession() {
    // this.socket?.close()
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
    if (this.socket?.readyState === 0) {
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
    if (this.socket?.readyState === 0) {
      console.log('socket not ready')
      return
    }
    if (command.type !== 'modeling_cmd_req') return
    const cmd = command.cmd
    if (cmd.type === 'camera_drag_move' && this.lossyDataChannel) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.lossyDataChannel.send(JSON.stringify(command))
      return
    } else if (cmd.type === 'highlight_set_entity' && this.lossyDataChannel) {
      cmd.sequence = this.outSequence
      this.outSequence++
      this.lossyDataChannel.send(JSON.stringify(command))
      return
    }
    console.log('sending command', command)
    this.socket?.send(JSON.stringify(command))
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

    if (this.socket?.readyState === 0) {
      console.log('socket not ready')
      return new Promise(() => {})
    }
    this.socket?.send(JSON.stringify(command))
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
