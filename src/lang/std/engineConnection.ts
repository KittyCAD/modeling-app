import { SourceRange } from '../executor'
import { Selections } from '../../useStore'

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
  interaction: 'rotate'
  window: {
    x: number
    y: number
  }
}

type uuid = string
interface XYZ {
  x: number
  y: number
  z: number
}
interface EngineCommand {
  type: 'ModelingCmdReq'
  cmd: {
    StartPath?: {}
    MovePathPen?: {
      path: uuid
      to: XYZ
    }
    ExtendPath?: {
      path: uuid
      segment: {
        Line: {
          end: XYZ
        }
      }
    }
    ClosePath?:  {
      path_id: uuid
    }
    Extrude?: {
      target: uuid
      distance: number
      cap: boolean
    }
    CameraDragMove?: MouseStuff
    CameraDragStart?: MouseStuff
    CameraDragEnd?: MouseStuff
  }
  cmd_id: uuid
  file_id: uuid
}

export class EngineCommandManager {
  artifactMap: ArtifactMap = {}
  sourceRangeMap: SourceRangeMap = {}
  socket?: WebSocket
  pc?: RTCPeerConnection
  onHoverCallback: (id?: string) => void = () => {}
  onClickCallback: (selection: SelectionsArgs) => void = () => {}
  onCursorsSelectedCallback: (selections: CursorSelectionsArgs) => void =
    () => {}
  constructor(setMediaStream: (stream: MediaStream) => void) {
    const url = 'wss://api.dev.kittycad.io/ws/modeling/commands'
    this.socket = new WebSocket(url)
    this.pc = new RTCPeerConnection()
    this.socket.addEventListener('open', (event) => {
      console.log('Connected to websocket, waiting for ICE servers')
    })

    this.socket.addEventListener('close', (event) => {
      console.log('websocket connection closed')
    })

    this.socket.addEventListener('error', (event) => {
      console.log('websocket connection error')
    })

    this?.socket?.addEventListener('message', (event) => {
      if (!this.pc || !this.socket) return

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
        if (message.type === 'SDPAnswer') {
          this.pc.setRemoteDescription(
            new RTCSessionDescription(message.answer)
          )
        } else if (message.type === 'IceServerInfo') {
          console.log('received IceServerInfo')
          this.pc.setConfiguration({
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
              console.log('sent SDPOffer')
              this.socket.send(
                JSON.stringify({
                  type: 'SDPOffer',
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
              console.log('sent SDPOffer begin')
              const msg = JSON.stringify({
                type: 'SDPOffer',
                offer: this.pc?.localDescription,
              })
              this.socket?.send(msg)
            })
            .catch(console.log)
        }
        // TODO talk to the gang about this
        // the following message types are made up
        // and are placeholders
        else if (message.type === 'hover') {
          this.onHoverCallback(message.id)
        } else if (message.type === 'click') {
          this.onClickCallback(message)
        } else {
          console.log('other message', message)
        }
      }
    })
  }

  startNewSession() {
    this.artifactMap = {}
    this.sourceRangeMap = {}

    // socket.on('command', ({ id, data }: any) => {
    //   const command = this.artifactMap[id]
    //   const geos: any = {}
    //   if (data.geo) {
    //     geos.position = data.position
    //     geos.rotation = data.rotation
    //     geos.originalId = data.originalId
    //     try {
    //       geos.geo = stlLoader.parse(data.geo)
    //     } catch (e) {}
    //   } else {
    //     Object.entries(data).forEach(([key, val]: [string, any]) => {
    //       let bufferGeometry = new BufferGeometry()
    //       try {
    //         bufferGeometry = stlLoader.parse(val)
    //       } catch (e) {
    //         console.log('val', val)
    //       }
    //       geos[key] = bufferGeometry
    //     })
    //   }

    //   if (command && command.type === 'pending') {
    //     const resolve = command.resolve
    //     this.artifactMap[id] = {
    //       type: 'result',
    //       data: geos,
    //     }
    //     resolve({
    //       id,
    //       geo: geos,
    //     })
    //   } else {
    //     this.artifactMap[id] = {
    //       type: 'result',
    //       data: geos,
    //     }
    //   }
    // })
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
    if (!this.socket?.OPEN) {
      console.log('socket not open')
      return new Promise(() => {})
    }
    this.sourceRangeMap[id] = range

    // return early if the socket is still in CONNECTING state
    if (this.socket?.readyState === 0) {
      console.log('socket not ready')
      return new Promise(() => {})
    }
    console.log('sending command', {
      id,
      data: params,
      command,
    })
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
