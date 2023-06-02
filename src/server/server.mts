import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { Mesh } from 'three'
const exporter = new STLExporter()

import { extrudeGeo, lineGeo, sketchBaseGeo } from '../lang/engine.js'

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
  },
})

let theMap: { [key: string]: any } = {}

io.on('connection', (socket) => {
  console.log('a user connected')

  socket.on('startNewSession', () => {
    // theMap = {}
    console.log('starting new session')
  })

  socket.on('command', ({ name, data, id }) => {
    console.log('got command!!', name)
    if (name === 'lineGeo') {
      const params = data as any[]
      theMap[id] = params[0]
      const result: any = {}
      Object.entries(lineGeo(params[0])).forEach(([key, val]) => {
        const stlString = exporter.parse(new Mesh(val))
        result[key] = stlString
      })
      socket.emit('command', {
        id,
        data: result,
      })
    } else if (name === 'sketchBaseGeo') {
      const result: any = {}
      theMap[id] = data[0]
      Object.entries(sketchBaseGeo(data[0])).forEach(([key, val]) => {
        const stlString = exporter.parse(new Mesh(val))
        result[key] = stlString
      })
      socket.emit('command', {
        id,
        data: result,
      })
      // } else if (name === 'extrudeGeo') {
      //   theMap[id] = data[0]
      //   let _result = extrudeGeo(data[0])
      //   const result = {
      //     ..._result,
      //     geo: exporter.parse(new Mesh(_result.geo)),
      //   }
      //   console.log('did extrudeGeo', result)
      //   socket.emit('command', {
      //     id,
      //     data: result,
      //   })
    } else if (name === 'extrudeSeg') {
      theMap[id] = data[0]
      const lineParams = theMap[data[0].segId]
      let _result = extrudeGeo({
        to: lineParams.to,
        from: lineParams.from,
        length: data[0].length,
        extrusionDirection: data[0].extrusionDirection,
      })
      const result = {
        ..._result,
        originalId: data[0].segId,
        geo: exporter.parse(new Mesh(_result.geo)),
      }
      socket.emit('command', {
        id,
        data: result,
      })
    }
  })
  socket.on('hover', (id) => {
    socket.emit('hover', id)
  })
  socket.on('click', (info) => {
    socket.emit('click', info)
  })
  socket.on('cursorsSelected', (info) => {
    socket.emit('cursorsSelected', info)
  })
})

server.listen(4000, () => {
  console.log('listening on *:4000')
})
