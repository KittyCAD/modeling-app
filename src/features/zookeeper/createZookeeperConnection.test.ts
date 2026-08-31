import type { MlCopilotServerMessage } from '@kittycad/lib'
import { encode as msgpackEncode } from '@msgpack/msgpack'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createZookeeperConnection } from '@src/features/zookeeper/createZookeeperConnection'

/** A WebSocket the test drives. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  binaryType = 'blob'
  sent: unknown[] = []
  closed = false

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.closed = true
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  server(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent)
  }

  binary(payload: unknown) {
    const bytes = msgpackEncode(payload)
    this.onmessage?.({ data: bytes.slice().buffer } as MessageEvent)
  }

  serverClose(code: number, reason = '') {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, reason } as CloseEvent)
  }

  jsonSent() {
    return this.sent
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => JSON.parse(entry) as Record<string, unknown>)
  }
}

const URL_BASE = 'wss://zookeeper.example/ws'

const connectionWith = (token: string | null = 'tok-1') =>
  createZookeeperConnection({ url: URL_BASE, token: () => token })

/** The message that ends the handshake. */
const assigned = (conversationId = 'conv-1'): MlCopilotServerMessage => ({
  conversation_id: { conversation_id: conversationId },
})

const latest = () => {
  const socket = FakeWebSocket.instances.at(-1)
  if (socket === undefined) throw new Error('no socket was opened')
  return socket
}

describe('createZookeeperConnection', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    FakeWebSocket.instances = []
    // biome-ignore lint/suspicious/noExplicitAny: substituting a browser global
    globalThis.WebSocket = FakeWebSocket as any
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    vi.useRealTimers()
  })

  it('starts offline', () => {
    expect(connectionWith().state.value).toMatchObject({
      status: 'offline',
      stage: null,
      superseded: false,
    })
  })

  it('refuses to connect without a token', async () => {
    await expect(connectionWith(null).connect()).rejects.toThrow(/signed in/i)
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  /**
   * A browser cannot set headers on a websocket handshake, so authentication is
   * a message. Same constraint the engine connection works around.
   */
  it('authenticates with a message once the socket opens', () => {
    const connection = connectionWith('tok-1')
    void connection.connect()

    expect(connection.state.value.stage).toBe('websocket')
    latest().open()

    expect(connection.state.value.stage).toBe('authenticating')
    expect(latest().jsonSent()[0]).toEqual({
      type: 'headers',
      headers: { Authorization: 'Bearer tok-1' },
    })
  })

  /**
   * An open socket with no conversation cannot be sent a prompt, so the
   * handshake is not over until the service names one.
   */
  it('resolves only when a conversation is assigned', async () => {
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()

    expect(connection.state.value.status).toBe('connecting')

    latest().server(assigned('conv-7'))
    await expect(connecting).resolves.toBeUndefined()

    expect(connection.state.value).toMatchObject({
      status: 'connected',
      stage: 'ready',
      conversationId: 'conv-7',
    })
  })

  it('asks to resume a conversation, replaying it', () => {
    const connection = connectionWith()
    void connection.connect({ conversationId: 'conv-9', replay: true })

    const opened = new URL(latest().url)
    expect(opened.searchParams.get('conversation_id')).toBe('conv-9')
    expect(opened.searchParams.get('replay')).toBe('true')
  })

  it('does not ask to replay when no conversation was named', () => {
    const connection = connectionWith()
    void connection.connect({ replay: true })

    const opened = new URL(latest().url)
    expect(opened.searchParams.get('conversation_id')).toBeNull()
    expect(opened.searchParams.get('replay')).toBeNull()
  })

  it('publishes server messages to its listeners', async () => {
    const connection = connectionWith()
    const seen: MlCopilotServerMessage[] = []
    connection.onMessage((message) => seen.push(message))

    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    latest().server({ delta: { delta: 'hello' } })

    expect(seen.at(-1)).toEqual({ delta: { delta: 'hello' } })
  })

  /** The service answers in JSON *or* MessagePack, and does not negotiate which. */
  it('decodes a binary frame as well as a JSON one', async () => {
    const connection = connectionWith()
    const seen: MlCopilotServerMessage[] = []
    connection.onMessage((message) => seen.push(message))

    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    latest().binary({ delta: { delta: 'packed' } })

    expect(seen.at(-1)).toEqual({ delta: { delta: 'packed' } })
  })

  it('survives a frame it cannot decode', async () => {
    const connection = connectionWith()
    const seen: MlCopilotServerMessage[] = []
    connection.onMessage((message) => seen.push(message))

    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    latest().onmessage?.({ data: 'not json at all' } as MessageEvent)
    latest().server({ delta: { delta: 'still here' } })

    expect(connection.state.value.status).toBe('connected')
    expect(seen.at(-1)).toEqual({ delta: { delta: 'still here' } })
  })

  it('keeps a listener that throws from breaking the others', async () => {
    const connection = connectionWith()
    const seen: string[] = []
    connection.onMessage(() => {
      throw new Error('bad observer')
    })
    connection.onMessage(() => seen.push('good'))

    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    seen.length = 0
    latest().server({ delta: { delta: 'x' } })
    expect(seen).toEqual(['good'])
  })

  it('keeps a pong to itself', async () => {
    const connection = connectionWith()
    const seen: MlCopilotServerMessage[] = []
    connection.onMessage((message) => seen.push(message))

    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    latest().server({ pong: {} })

    // The handshake message is published — a conversation wants its remote id —
    // but a pong is proof of life and nothing more.
    expect(seen.some((message) => 'pong' in message)).toBe(false)
  })

  it('gives up when no conversation is assigned in time', async () => {
    vi.useFakeTimers()
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()

    vi.advanceTimersByTime(120_000)

    await expect(connecting).rejects.toThrow(/did not assign a conversation/i)
    expect(connection.state.value.status).toBe('failed')
  })

  it('gives up when a ping goes unanswered', async () => {
    vi.useFakeTimers()
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    // One heartbeat goes out, and nothing comes back.
    vi.advanceTimersByTime(4_000)
    expect(
      latest()
        .jsonSent()
        .some((m) => m.type === 'ping')
    ).toBe(true)

    vi.advanceTimersByTime(30_000)
    expect(connection.state.value).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/did not answer a ping/i),
    })
  })

  it('stays alive while pings are answered', async () => {
    vi.useFakeTimers()
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    for (let beat = 0; beat < 5; beat += 1) {
      vi.advanceTimersByTime(4_000)
      latest().server({ pong: {} })
    }
    // Less than a pong timeout has elapsed since the last answered ping.
    vi.advanceTimersByTime(20_000)

    expect(connection.state.value.status).toBe('connected')
    expect(connection.state.value.error).toBeNull()
  })

  /**
   * **The one place this genuinely departs from the engine's template.** Its
   * close handler reads only `reason`; a superseded conversation has to be
   * recognised by *code*, because retrying it is what makes two clients kick each
   * other off in a loop.
   */
  it('marks a superseded conversation and does not invite a retry', async () => {
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()

    latest().serverClose(4409)

    await expect(connecting).rejects.toThrow(/opened somewhere else/i)
    expect(connection.state.value).toMatchObject({
      status: 'failed',
      superseded: true,
    })
  })

  it('does not mark an ordinary close as superseded', async () => {
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()

    latest().serverClose(1006)

    await expect(connecting).rejects.toThrow(/connection closed/i)
    expect(connection.state.value.superseded).toBe(false)
  })

  /**
   * `backend_shutdown` is a message, so it arrives while the socket still works.
   * Keeping it means the close does not overwrite a specific reason with a
   * generic one.
   */
  it('reports the reason the service gave before it closed', async () => {
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    latest().server({ backend_shutdown: { reason: 'deploying' } })
    latest().serverClose(1001)

    expect(connection.state.value.error).toBe('deploying')
  })

  it('fails on an access denial, and passes it on for the UI', async () => {
    const connection = connectionWith()
    const seen: MlCopilotServerMessage[] = []
    connection.onMessage((message) => seen.push(message))

    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    latest().server({
      access_denied: {
        code: 'billing_threshold_reached',
        detail: 'Out of credits.',
        retryable: false,
      },
    })

    expect(connection.state.value).toMatchObject({
      status: 'failed',
      error: 'Out of credits.',
    })
    // The banner needs the code, so the message is published as well as failing.
    expect(seen.some((message) => 'access_denied' in message)).toBe(true)
  })

  it('refuses a second connect while one is in flight', async () => {
    const connection = connectionWith()
    void connection.connect()

    await expect(connection.connect()).rejects.toThrow(/already connecting/i)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('is a no-op to connect when already connected', async () => {
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    await expect(connection.connect()).resolves.toBeUndefined()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  /** A previous half-open socket must not be left behind by the next attempt. */
  it('tears the old socket down before opening a new one', async () => {
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()
    latest().serverClose(1006)
    await expect(connecting).rejects.toThrow()

    const first = FakeWebSocket.instances[0]
    void connection.connect()

    expect(FakeWebSocket.instances).toHaveLength(2)
    // Already closed by the server, so there is nothing to close — what matters
    // is that its handlers are gone, so it can no longer speak for us.
    expect(first.onmessage).toBeNull()
    expect(first.onclose).toBeNull()
  })

  it('goes quiet when disconnected', async () => {
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    const socket = latest()
    connection.disconnect()

    expect(connection.state.value).toMatchObject({
      status: 'offline',
      stage: null,
      error: null,
    })
    expect(socket.closed).toBe(true)
    // Handlers were cleared, so its own close cannot look like a failure.
    expect(socket.onclose).toBeNull()
  })

  it('sends nothing once the socket is gone', async () => {
    const connection = connectionWith()
    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    const socket = latest()
    const before = socket.sent.length
    connection.disconnect()
    connection.send({ type: 'ping' })

    expect(socket.sent).toHaveLength(before)
  })

  it('drops its listeners on dispose', async () => {
    const connection = connectionWith()
    const seen: MlCopilotServerMessage[] = []
    connection.onMessage((message) => seen.push(message))

    const connecting = connection.connect()
    latest().open()
    latest().server(assigned())
    await connecting

    const socket = latest()
    seen.length = 0
    connection.dispose()
    socket.onmessage?.({
      data: JSON.stringify({ delta: { delta: 'late' } }),
    } as MessageEvent)

    expect(seen).toEqual([])
  })
})
