import { SourceRange } from '../executor'
import { Selections } from '../../useStore'
import { VITE_KC_API_WS_MODELING_URL } from '../../env'
import { Models } from '@kittycad/lib'

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

// TODO these types should be in the openApi spec, and therefore in @kittycad/lib
interface MouseStuff {
  interaction: 'rotate' | 'pan' | 'zoom'
  window: {
    x: number
    y: number
  }
}

interface MouseDrag extends MouseStuff {
  sequence?: number
}

type uuid = string
interface XYZ {
  x: number
  y: number
  z: number
}

export type _EngineCommand = Models['modeling_cmd_req_type']

export interface EngineCommand extends _EngineCommand {
  type: 'modeling_cmd_req'
}

export class EngineCommandManager {
  artifactMap: ArtifactMap = {}
  sourceRangeMap: SourceRangeMap = {}
  sequence = 0
  socket?: WebSocket
  pc?: RTCPeerConnection
  lossyDataChannel?: RTCDataChannel
  waitForReady: Promise<void> = new Promise(() => {})
  private resolveReady = () => {}
  onHoverCallback: (id?: string) => void = () => {}
  onClickCallback: (selection: SelectionsArgs) => void = () => {}
  onCursorsSelectedCallback: (selections: CursorSelectionsArgs) => void =
    () => {}
  constructor({
    setMediaStream,
    setIsStreamReady,
    token,
  }: {
    setMediaStream: (stream: MediaStream) => void
    setIsStreamReady: (isStreamReady: boolean) => void
    token?: string
  }) {
    this.waitForReady = new Promise((resolve) => {
      this.resolveReady = resolve
    })

    this.socket = new WebSocket(VITE_KC_API_WS_MODELING_URL, [])
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
      console.log('websocket connection closed')
    })

    this.socket.addEventListener('error', (event) => {
      console.log('websocket connection error')
    })

    this?.socket?.addEventListener('message', (event) => {
      if (!this.socket || !this.pc) return

      //console.log('Message from server ', event.data);
      if (event.data instanceof Blob) {
        const reader = new FileReader()

        reader.onload = () => {
          //console.log("Result: " + reader.result);
        }

        reader.readAsText(event.data)
      } else if (
        typeof event.data === 'string' &&
        event.data.toLocaleLowerCase().startsWith('error')
      ) {
        console.warn('something went wrong: ', event.data)
      } else {
        const message = JSON.parse(event.data)
        if (message.type === 's_d_p_answer') {
          this.pc?.setRemoteDescription(
            new RTCSessionDescription(message.answer)
          )
        } else if (message.type === 'ice_server_info' && this.pc) {
          console.log('received ice_server_info')
          this.pc?.setConfiguration({
            iceServers: message.ice_servers,
          })
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
              console.log('sent s_d_p_offer')
              this.socket.send(
                JSON.stringify({
                  type: 's_d_p_offer',
                  offer: this.pc.localDescription,
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
              console.log('sent s_d_p_offer begin')
              const msg = JSON.stringify({
                type: 's_d_p_offer',
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
              console.log('lossy data channel message: ', event)
            })
          })
        } else if (message.cmd_id) {
          const id = message.cmd_id
          const command = this.artifactMap[id]
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
          // TODO talk to the gang about this
          // the following message types are made up
          // and are placeholders
        } else if (message.type === 'hover') {
          this.onHoverCallback(message.id)
        } else if (message.type === 'click') {
          this.onClickCallback(message)
        } else {
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
  onClick(callback: (selection: SelectionsArgs) => void) {
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
    // TODO talk to the gang about this
    // Really idBasedSelections is the only part that's relevant to the server, but it's when
    // the user puts their cursor over a line of code, and there is a engine-id associated with
    // it, so we want to tell the engine to change it's color or something
    if (this.socket?.readyState === 0) {
      console.log('socket not open')
      return
    }
    console.log('sending cursorsSelected')
    this.socket?.send(
      JSON.stringify({ command: 'cursorsSelected', body: selections })
    )
  }
  sendSceneCommand(command: EngineCommand) {
    if (this.socket?.readyState === 0) {
      console.log('socket not ready')
      return
    }
    const cmd = command.cmd
    if (cmd.type === 'camera_drag_move' && this.lossyDataChannel) {
      console.log('sending lossy command', command, this.lossyDataChannel)
      cmd.sequence = this.sequence
      this.sequence++
      this.lossyDataChannel.send(JSON.stringify(command))
      return
    }
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
