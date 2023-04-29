import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { Mesh } from 'three';
const exporter = new STLExporter();

import { lineGeo, sketchBaseGeo } from '../lang/engine.js'

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
  },
})

let theMap: {[key: string]: any} = {}

io.on('connection', (socket) => {
  console.log('a user connected')

  socket.on('startNewSession', () => {
    theMap = {}
    console.log('starting new session')
  })

  socket.on('command', yo => {
    console.log('got command!!', yo.name)
    if(yo.name === 'lineGeo') {
      const params = yo.data as any[]
      console.log('params', params)
      const result: any = {}
      Object.entries(lineGeo(params[0])).forEach(([key, val]) => {
        const stlString = exporter.parse(new Mesh(val));
        result[key] = stlString
      })
      console.log('returning result')
      socket.emit('command', {
        id: yo.id,
        data: result,
      })
    } else if( yo.name === 'sketchBaseGeo'){
      const result: any = {}
      Object.entries(sketchBaseGeo(yo.data[0])).forEach(([key, val]) => {
        const stlString = exporter.parse(new Mesh(val));
        result[key] = stlString
      })
      socket.emit('command', {
        id: yo.id,
        data: result,
      })
    }
  })
})

server.listen(4000, () => {
  console.log('listening on *:4000')
})
