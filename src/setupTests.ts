// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'
import WebSocket from 'ws';
import 'setimmediate'

class WebsocketWrapper {
  constructor(url: string) {
    return new WebSocket(url, {
        headers: {
            'Autherization': `Bearer ${import.meta.env.KITTYCAD_TOKEN}`,
        }
    })
  }
}

class MockRTCPeerConnection {
  constructor() {
  }
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
global.WebSocket = WebsocketWrapper