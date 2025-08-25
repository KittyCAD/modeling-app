import { Connection } from '@src/network/connection'
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
        pong:undefined
      })
      expect(connection.connectionPromise).toBe(null)
      expect(connection.connectionPromiseResolve).toBe(null)
      expect(connection.connectionPromiseReject).toBe(null)
    })
  })
  describe('startPingPong', ()=>{
    it('should ping once', async ()=>{
        const connectionManager = new ConnectionManager()
        const connection = new Connection({
            connectionManager: connectionManager,
            url: TEST_URL,
            token: TEST_TOKEN,
        })

        connection.startPingPong()
        await new Promise((resolve, reject)=>{
            setTimeout(resolve, 1000)
        })
        connection.stopPingPong()
        expect(connection.pingPongSpan.ping).toBeLessThanOrEqual(Date.now())
        expect(connection.pingPongSpan.pong).toBe(undefined)
        expect(connection.pingIntervalId).toBe(undefined)
    })
  })
  describe('stopPingPong', ()=>{
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
})
