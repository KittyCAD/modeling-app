import { Connection, IEventListenerTracked } from '@src/network/connection'
import { ConnectionManager } from '@src/network/connectionManager'
import { ClientMetrics } from './utils'

const TEST_URL = 'nicenicenice'
const TEST_TOKEN = 'mycooltoken'

describe('connection.ts', () => {
  describe('initialize', () => {
    it('should make a default object', () => {
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      expect(connection.url).toBe(TEST_URL)
      expect(connection.token).toBe(TEST_TOKEN)
      expect(connection.pingPongSpan).toStrictEqual({
        ping: undefined,
        pong: undefined,
      })
      expect(connection.connectionPromise).toBe(null)
      expect(connection.connectionPromiseResolve).toBe(null)
      expect(connection.connectionPromiseReject).toBe(null)
      expect(connection.allEventListeners).toStrictEqual(new Map())
    })
  })
  describe('stopPingPong', () => {
    it('should check that pingIntervalId is undefined if you stopPingPong immediately', () => {
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      expect(connection.pingIntervalId).toBe(undefined)
      connection.stopPingPong()
      expect(connection.pingIntervalId).toBe(undefined)
    })
  })
  describe('trackListener', () => {
    it('should add one listener to the map', () => {
      const expected = new Map<string, IEventListenerTracked>()
      const fn = () => {}
      expected.set('open', { event: 'open', callback: fn, type: 'window' })
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      connection.trackListener('open', {
        event: 'open',
        callback: fn,
        type: 'window',
      })
      expect(connection.allEventListeners).toStrictEqual(expected)
    })
    it('should add two listeners to the map', () => {
      const expected = new Map<string, IEventListenerTracked>()
      const fn = () => {}
      const fn2 = () => {}
      expected.set('open', { event: 'open', callback: fn, type: 'window' })
      expected.set('close', { event: 'close', callback: fn2, type: 'window' })
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      connection.trackListener('open', {
        event: 'open',
        callback: fn,
        type: 'window',
      })
      connection.trackListener('close', {
        event: 'close',
        callback: fn2,
        type: 'window',
      })
      expect(connection.allEventListeners).toStrictEqual(expected)
    })
    it('should error if you try to add the same key', () => {
      const expected = new Map<string, IEventListenerTracked>()
      const fn = () => {}
      expected.set('open', { event: 'open', callback: fn, type: 'window' })
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      connection.trackListener('open', {
        event: 'open',
        callback: fn,
        type: 'window',
      })
      expect(() =>
        connection.trackListener('open', {
          event: 'open',
          callback: () => {},
          type: 'window',
        })
      ).toThrow(
        `You are trying to track something twice, good luck! you're crashing. open`
      )
    })
  })
  describe('setMediaStream', () => {
    it('should set a mediaStream', () => {
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      const mediaStream = new MediaStream()
      connection.setMediaStream(mediaStream)
      expect(connection.mediaStream).toStrictEqual(mediaStream)
    })
  })
  describe('setWebrtcStatsCollector', () => {
    it('should set webrtcStatsCollector', () => {
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      const expected = async () => {
        let metrics: ClientMetrics = {}
        return metrics
      }
      connection.setWebrtcStatsCollector(expected)
      expect(connection.webrtcStatsCollector).toStrictEqual(expected)
    })
  })
  describe('setUnreliableDataChannel', () => {
    it('should set unreliableDataChannel', () => {
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      const peerConenction = new RTCPeerConnection()
      const dataChannel = peerConenction.createDataChannel('my channel')
      connection.setUnreliableDataChannel(dataChannel)
      expect(connection.unreliableDataChannel).toStrictEqual(dataChannel)
    })
  })
  describe('setPong', () => {
    it('should set pong', () => {
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      connection.setPong(42)
      expect(connection.pingPongSpan.pong).toBe(42)
    })
  })
  describe('setPing', () => {
    it('should set ping', () => {
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      connection.setPing(10)
      expect(connection.pingPongSpan.ping).toBe(10)
    })
  })
})
