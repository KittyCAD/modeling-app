import '@testing-library/jest-dom'
import { WebSocket } from 'ws'
import 'vitest-canvas-mock'

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
