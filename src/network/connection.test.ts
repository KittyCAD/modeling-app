import {Connection} from '@src/network/connection'
import {ConnectionManager} from '@src/network/connectionManager'

const TEST_URL = 'nicenicenice'
const TEST_TOKEN = 'mycooltoken'

describe('connection.ts', () => {
    describe('initialize', () => {
        it('should make a default object', () => {
            const connectionManager = new ConnectionManager()
            const connection = new Connection({
                connectionManager: connectionManager,
                url: TEST_URL,
                token: TEST_TOKEN
            })
        })
    })
})