// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'
import WebSocket from 'ws';
import 'setimmediate'
// @ts-ignore
import wrtc from 'wrtc'

class WebsocketWrapper {
  constructor(url: string) {
    return new WebSocket(url, {
        headers: {
            'Autherization': `Bearer ${process.env.KITTYCAD_TOKEN}`,
        }
    })
  }
}

global.RTCPeerConnection = wrtc.RTCPeerConnection
// @ts-ignore
global.WebSocket = WebsocketWrapper