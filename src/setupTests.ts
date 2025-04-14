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
