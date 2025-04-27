import '@testing-library/jest-dom'
import fetch from 'node-fetch'
import { vi } from 'vitest'
import 'vitest-webgl-canvas-mock'
import { WebSocket } from 'ws'

// @ts-ignore
globalThis.fetch = fetch

class MockRTCPeerConnection {
  createDataChannel() {
    return
  }
  setRemoteDescription() {
    return Promise.resolve()
  }
  setConfiguration() {
    return Promise.resolve()
  }
  addEventListener() {
    return Promise.resolve()
  }
  get localDescription() {
    return Promise.resolve()
  }
  addTransceiver() {
    return Promise.resolve()
  }
  createOffer() {
    return Promise.resolve()
  }
  setLocalDescription() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
}

// @ts-ignore
global.RTCPeerConnection = MockRTCPeerConnection
// @ts-ignore
global.WebSocket = WebSocket

vi.mock('three', async () => {
  const originalModule = (await vi.importActual('three')) as any
  return {
    ...originalModule,
    WebGLRenderer: class {
      domElement: HTMLDivElement
      constructor() {
        // this.domElement = document.createElement('canvas')
        this.domElement = document.createElement('div')
      }

      setClearColor() {}
      setSize() {}
      render() {}
      dispose() {}
      // Add any other methods or properties that are used in your components
    },
    // Mock other 'three' exports if necessary
  }
})

/// Cleanup the engine connection if we had one.
/*
import { afterAll } from 'vitest'
import { engineCommandManager } from '@src/lib/singletons'

afterEach(async () => {
  const ws = engineCommandManager.engineConnection?.websocket as any
  if (ws) {
    await finishWebSocket(ws)
  }
  engineCommandManager.tearDown()
})

// 1️⃣  make timers fake
beforeAll(() => vi.useFakeTimers())

// 2️⃣  restore real timers when the suite is done
afterAll(() => vi.useRealTimers())

/// Cleanup fake timers
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.clearAllTimers()
})

async function finishWebSocket(ws: WebSocket) {
  if (!ws) return

  // Drop ws’s own 30-s watchdog *first*
  clearTimeout((ws as any)._closeTimer)

  // Politely ask to close
  if (ws.readyState < 2) ws.close(1000)

  // Wait up to 100 ms (real time) for the close to complete,
  // then hard-kill synchronously.
  await new Promise<void>((res) => {
    const realTimer = setTimeout(() => {
      ws.terminate() // nukes socket & DNS/TLS handles
      res()
    }, 100) // real timer, not affected by vi.useFakeTimers()

    ws.once('close', () => {
      clearTimeout(realTimer) // handshake succeeded
      res()
    })
  })
}

/// Cleanup happyDOM
afterEach(() => (globalThis as any).happyDOM?.cancelAsync?.())

afterAll(() => {
  for (const h of (process as any)._getActiveHandles()) {
    if (h.constructor?.name === 'FSWatcher') {
      console.log('FSWatcher:', h)
    }
  }
})

import why from 'why-is-node-running'
afterAll(() => {
  console.error('\n----- LIVE HANDLES -----')
  why() // prints sockets, timers, file-watchers with stacks
})*/
