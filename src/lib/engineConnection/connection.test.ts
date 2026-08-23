import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Connection } from '@src/lib/engineConnection/connection'
import {
  PING_INTERVAL_MS,
  PONG_TIMEOUT_CLOSE_CODE,
  PONG_TIMEOUT_MS,
} from '@src/lib/engineConnection/utils'

const createConnection = () => {
  const send = vi.fn()
  const tearDownManager = vi.fn()
  const connection = new Connection({
    url: 'wss://example.test/modeling',
    token: '',
    handleOnDataChannelMessage: vi.fn(),
    tearDownManager,
    rejectPendingCommand: vi.fn(),
    handleMessage: vi.fn(),
    getCloudProjectId: () => undefined,
  })

  connection.websocket = {
    readyState: WebSocket.OPEN,
    send,
  } as unknown as WebSocket

  return { connection, send, tearDownManager }
}

describe('Connection heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('tears down once with a specific code when a pong times out', () => {
    const { connection, send, tearDownManager } = createConnection()

    connection.startPingPong()
    vi.advanceTimersByTime(PING_INTERVAL_MS)

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }))

    vi.advanceTimersByTime(PONG_TIMEOUT_MS)

    expect(tearDownManager).toHaveBeenCalledOnce()
    expect(tearDownManager).toHaveBeenCalledWith({
      websocketClosed: true,
      code: PONG_TIMEOUT_CLOSE_CODE.toString(),
    })

    vi.advanceTimersByTime(PONG_TIMEOUT_MS)
    expect(tearDownManager).toHaveBeenCalledOnce()
  })

  it('sends the next ping after receiving a pong', () => {
    const { connection, send, tearDownManager } = createConnection()

    connection.startPingPong()
    vi.advanceTimersByTime(PING_INTERVAL_MS)
    connection.setPong(Date.now())
    vi.advanceTimersByTime(PING_INTERVAL_MS)

    expect(send).toHaveBeenCalledTimes(2)
    expect(tearDownManager).not.toHaveBeenCalled()

    connection.stopPingPong()
  })
})
