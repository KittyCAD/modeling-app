import '@testing-library/jest-dom'
import util from 'util'
import fetch from 'isomorphic-fetch'
import dns from 'dns'

// Only needed because we run Node < 17
// and we want to open `localhost` not `127.0.0.1` on server start
// reference: https://vitejs.dev/config/server-options.html#server-host
dns.setDefaultResultOrder('verbatim')

class MockRTCPeerConnection {
  constructor() {}
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
global.fetch = fetch

// @ts-ignore
global.TextDecoder = util.TextDecoder
global.TextEncoder = util.TextEncoder
