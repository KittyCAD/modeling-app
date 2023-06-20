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

export class EngineCommandManager {
  artifactMap: ArtifactMap = {}
  sourceRangeMap: SourceRangeMap = {}
  socket?: WebSocket
  pc?: RTCPeerConnection
  onHoverCallback: (id?: string) => void = () => {}
  onClickCallback: (selection: SelectionsArgs) => void = () => {}
  onCursorsSelectedCallback: (selections: CursorSelectionsArgs) => void = () => {}
  constructor(setMediaStream: (stream: MediaStream) => void) {
    const url =
      'ws://jess-testing.hawk-dinosaur.ts.net:8080/ws/modeling/commands'
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
      } else {
        const message = JSON.parse(event.data)
        if (message.type === 'SDPAnswer') {
          this.pc.setRemoteDescription(new RTCSessionDescription(message.answer))
        } else if (message.type === 'IceServerInfo') {
          console.log('received IceServerInfo')
          this.pc.setConfiguration({
            iceServers: message.ice_servers,
          })
          this.pc.addEventListener('track', (event) => {
            const mediaStream = event.streams[0]
            setMediaStream(mediaStream)
          })
          
          this.pc.addEventListener('connectionstatechange', (e) =>
            console.log(this?.pc?.iceConnectionState))
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
          this.pc.createOffer()
            .then((descriptionInit) => this?.pc?.setLocalDescription(descriptionInit))
            .catch(console.log)
        } else
        // TODO talk to the gang about this
        // the following message types are made up
        // and are placeholders
        if (message.type === 'hover') {
          this.onHoverCallback(message.id)
        } else if (message.type === 'click') {
          this.onClickCallback(message)
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
    // this.socket2?.close()
    // socket.off('command')
  }
  onHover(callback: (id?: string) => void) {
    // It's when the user hovers over a part in the 3d scene, and so the engine should tell the 
    // frontend about that (with it's id) so that the FE can highlight code associated with that id
    this.onHoverCallback = callback
  }
  onClick(
    callback: (selection: SelectionsArgs) => void
  ) {
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
    this.socket?.send(JSON.stringify({command: 'cursorsSelected', body: selections}))
  }
  sendCommand({
    name,
    id,
    params,
    range,
  }: any ): Promise<any> {
  // }: {
  //   name: string
  //   id: string
  //   params: any
  //   range: SourceRange
  // }): Promise<any> {
    this.sourceRangeMap[id] = range
    this.socket?.send(JSON.stringify({command: 'command', body: {
      id,
      name,
      data: params,
    }}))
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
