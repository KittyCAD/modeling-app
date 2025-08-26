import { Connection, IEventListenerTracked } from '@src/network/connection'
import { ConnectionManager } from '@src/network/connectionManager'

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
      expected.set('open',{event:'open', callback: fn, type:'window'})
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      connection.trackListener('open',{event:'open', callback: fn, type:'window'})
      expect(connection.allEventListeners).toStrictEqual(expected)
    })
    it('should add two listeners to the map' , () => {
      const expected = new Map<string, IEventListenerTracked>()
      const fn = () => {}
      const fn2 = () => {}
      expected.set('open',{event:'open', callback: fn, type:'window'})
      expected.set('close',{event:'close', callback: fn2, type:'window'})
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      connection.trackListener('open',{event:'open', callback: fn, type:'window'})
      connection.trackListener('close',{event:'close', callback: fn2, type:'window'})
      expect(connection.allEventListeners).toStrictEqual(expected)
    })
    it('should error if you try to add the same key', () => {
      const expected = new Map<string, IEventListenerTracked>()
      const fn = () => {}
      expected.set('open',{event:'open', callback: fn, type:'window'})
      const connectionManager = new ConnectionManager()
      const connection = new Connection({
        connectionManager: connectionManager,
        url: TEST_URL,
        token: TEST_TOKEN,
      })
      connection.trackListener('open',{event:'open', callback: fn, type:'window'})
      expect(()=>connection.trackListener('open',{event:'open', callback: ()=>{}, type:'window'})).toThrow(`You are trying to track something twice, good luck! you're crashing. open`)
    })
  })
})
