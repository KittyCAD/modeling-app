import { io } from 'socket.io-client'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { SourceRange } from '../executor'
import { Selections } from '../../useStore'
import { BufferGeometry } from 'three'

const stlLoader = new STLLoader()

export const socket = io('http://localhost:4000')

socket.connect()

socket.on('connect', () => {
  // console.log('connected')
})

socket.on('disconnect', () => {
  // console.log('disconnected')
})

socket.on('connect_error', (error) => {
  // console.log('connect_error', error)
})

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

export class EngineCommandManager {
  artifactMap: ArtifactMap = {}
  sourceRangeMap: SourceRangeMap = {}
  constructor() {}

  startNewSession() {
    this.artifactMap = {}
    this.sourceRangeMap = {}
    socket.on('command', ({ id, data }: any) => {
      const command = this.artifactMap[id]
      const geos: any = {}
      if (data.geo) {
        geos.position = data.position
        geos.rotation = data.rotation
        geos.originalId = data.originalId
        try {
          geos.geo = stlLoader.parse(data.geo)
        } catch (e) {}
      } else {
        Object.entries(data).forEach(([key, val]: [string, any]) => {
          let bufferGeometry = new BufferGeometry()
          try {
            bufferGeometry = stlLoader.parse(val)
          } catch (e) {
            console.log('val', val)
          }
          geos[key] = bufferGeometry
        })
      }

      if (command && command.type === 'pending') {
        const resolve = command.resolve
        this.artifactMap[id] = {
          type: 'result',
          data: geos,
        }
        resolve({
          id,
          geo: geos,
        })
      } else {
        this.artifactMap[id] = {
          type: 'result',
          data: geos,
        }
      }
    })
  }
  endSession() {
    socket.off('command')
  }
  hover(id?: string) {
    socket.emit('hover', id)
  }
  onHover(callback: (id?: string) => void) {
    socket.on('hover', callback)
  }
  click(id: string, type: Selection['type'] = 'default') {
    socket.emit('click', { id, type })
  }
  onSelection(
    callback: (selection: {
      id: string
      type: Selections['codeBasedSelections'][number]['type']
    }) => void
  ) {
    socket.on('click', callback)
  }
  cusorsSelected(selections: {
    otherSelections: Selections['otherSelections']
    idBasedSelections: { type: string; id: string }[]
  }) {
    socket.emit('cursorsSelected', selections)
  }
  onCursorsSelected(
    callback: (selections: {
      otherSelections: Selections['otherSelections']
      idBasedSelections: { type: string; id: string }[]
    }) => void
  ) {
    socket.on('cursorsSelected', callback)
  }
  sendCommand({
    name,
    id,
    params,
    range,
  }: {
    name: string
    id: string
    params: any
    range: SourceRange
  }): Promise<any> {
    this.sourceRangeMap[id] = range
    socket.emit('command', {
      id,
      name,
      data: params,
    })
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
