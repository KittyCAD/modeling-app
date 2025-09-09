import { Connection } from '@src/network/connection'
import type { ClientMetrics, IEventListenerTracked } from '@src/network/utils'

const TEST_URL = 'nicenicenice'
const TEST_TOKEN = 'mycooltoken'
const HANDLE_NO_OP = () => {}
const TEAR_DOWN_MANAGER_NO_OP = () => {}
const REJECT_PENDING_COMMAND_NO_OP = () => {}

describe('connection.ts', () => {
  describe('initialize', () => {
    it('should make a default object', () => {
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
      })
      expect(connection.url).toBe(TEST_URL)
      expect(connection.token).toBe(TEST_TOKEN)
      expect(connection.pingPongSpan).toStrictEqual({
        ping: undefined,
        pong: undefined,
      })
      expect(connection.deferredConnection).toBe(null)
      expect(connection.deferredPeerConnection).toBe(null)
      expect(connection.deferredMediaStreamAndWebrtcStatsCollector).toBe(null)
      expect(connection.deferredSdpAnswer).toBe(null)
      expect(connection.allEventListeners).toStrictEqual(new Map())
      expect(connection.exclusiveConnection).toBe(false)
    })
  })
  describe('stopPingPong', () => {
    it('should check that pingIntervalId is undefined if you stopPingPong immediately', () => {
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
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
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
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
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
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
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
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
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
      })
      const mediaStream = new MediaStream()
      connection.setMediaStream(mediaStream)
      expect(connection.mediaStream).toStrictEqual(mediaStream)
    })
  })
  describe('setWebrtcStatsCollector', () => {
    it('should set webrtcStatsCollector', () => {
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
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
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
      })
      const peerConnection = new RTCPeerConnection()
      const dataChannel = peerConnection.createDataChannel('my channel')
      connection.setUnreliableDataChannel(dataChannel)
      expect(connection.unreliableDataChannel).toStrictEqual(dataChannel)
    })
  })
  describe('setPong', () => {
    it('should set pong', () => {
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
      })
      connection.setPong(42)
      expect(connection.pingPongSpan.pong).toBe(42)
    })
  })
  describe('setPing', () => {
    it('should set ping', () => {
      const connection = new Connection({
        url: TEST_URL,
        token: TEST_TOKEN,
        handleOnDataChannelMessage: HANDLE_NO_OP,
        tearDownManager: TEAR_DOWN_MANAGER_NO_OP,
        rejectPendingCommand: REJECT_PENDING_COMMAND_NO_OP,
      })
      connection.setPing(10)
      expect(connection.pingPongSpan.ping).toBe(10)
    })
  })
})
