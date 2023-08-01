import '@testing-library/jest-dom'
import util from 'util'
import fetch from 'isomorphic-fetch'
import fs from 'fs'

jest.mock('./env', () => {
  // and set all the env vars from .env.development
  const mockVars: { [key: string]: string } = {}
  fs.readFileSync('.env.development', 'utf8')
    .split('\n')
    .map((line) => line.split('='))
    .forEach(([key, value]) => (mockVars[key] = value))
  return mockVars
})

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
