// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'
import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import matchers from '@testing-library/jest-dom/matchers'
import WebSocket from 'ws'
import 'setimmediate'
// @ts-ignore
import wrtc from 'wrtc'

class WebsocketWrapper {
  constructor(url: string) {
    return new WebSocket(url, {
        headers: {
            'Autherization': `Bearer ${import.meta.env.KITTYCAD_TOKEN}`,
        }
    })
  }
}

global.RTCPeerConnection = wrtc.RTCPeerConnection
// @ts-ignore
global.WebSocket = WebsocketWrapper

// extends Vitest's expect method with methods from react-testing-library
expect.extend(matchers)

// runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup()
})