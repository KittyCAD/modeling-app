import {
  decode as msgpackDecode,
  encode as msgpackEncode,
} from '@msgpack/msgpack'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngineConnection } from '@src/features/engine/createEngineConnection'

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
  }

  /** Open the socket, as the browser would. */
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  /** Deliver a JSON message from the server. */
  server(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent)
  }

  /** Deliver a binary (msgpack) frame. */
  binary(payload: unknown) {
    const bytes = msgpackEncode(payload)
    const buffer = bytes.slice().buffer
    this.onmessage?.({ data: buffer } as MessageEvent)
  }

  /** JSON messages this app sent, parsed. */
  jsonSent() {
    return this.sent
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => JSON.parse(entry))
  }

  binarySent() {
    return this.sent.filter((entry) => entry instanceof ArrayBuffer)
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null
  ontrack: ((event: RTCTrackEvent) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  connectionState: RTCPeerConnectionState = 'new'

  configuration: RTCConfiguration
  transceivers: unknown[] = []
  channels: string[] = []
  remoteDescription: RTCSessionDescriptionInit | null = null
  localDescription: RTCSessionDescriptionInit | null = null
  candidates: RTCIceCandidateInit[] = []

  constructor(configuration: RTCConfiguration = {}) {
    this.configuration = configuration
    FakePeerConnection.instances.push(this)
  }

  createDataChannel(name: string) {
    this.channels.push(name)
    return { close: () => {} } as RTCDataChannel
  }

  addTransceiver(kind: string, init: unknown) {
    this.transceivers.push({ kind, init })
  }

  async createOffer() {
    return { type: 'offer' as const, sdp: 'v=0 offer' }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.candidates.push(candidate)
  }

  close() {
    this.connectionState = 'closed'
  }

  /** Deliver the video track, which is what "connected" means. */
  track() {
    const stream = { id: 'stream' } as MediaStream
    this.ontrack?.({ streams: [stream] } as unknown as RTCTrackEvent)
  }
}

const originalWebSocket = globalThis.WebSocket
const originalPeerConnection = globalThis.RTCPeerConnection

function connect(token: string | null = 'test-token') {
  const connection = createEngineConnection({
    baseUrl: 'wss://engine.example.dev/ws/modeling/commands',
    token: () => token,
  })
  const promise = connection.connect({ width: 800, height: 600 })
  // Nothing should reject unobserved; each test asserts on it explicitly.
  promise.catch(() => {})
  return { connection, promise }
}

const socket = () => FakeWebSocket.instances.at(-1) as FakeWebSocket
const peer = () => FakePeerConnection.instances.at(-1) as FakePeerConnection

/** Walk the handshake to a live stream. */
async function completeHandshake() {
  socket().open()
  socket().server({
    success: true,
    resp: {
      type: 'ice_server_info',
      data: { ice_servers: [{ urls: 'turn:x' }] },
    },
  })
  // The offer is created asynchronously.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  socket().server({
    success: true,
    resp: {
      type: 'sdp_answer',
      data: { answer: { type: 'answer', sdp: 'v=0' } },
    },
  })
  await Promise.resolve()
  peer().track()
}

describe('engine connection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    FakePeerConnection.instances = []
    // biome-ignore lint/suspicious/noExplicitAny: substituting browser globals
    globalThis.WebSocket = FakeWebSocket as any
    // biome-ignore lint/suspicious/noExplicitAny: substituting browser globals
    globalThis.RTCPeerConnection = FakePeerConnection as any
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    globalThis.RTCPeerConnection = originalPeerConnection
    vi.useRealTimers()
  })

  it('refuses to connect with no token, rather than opening a socket', async () => {
    const { connection, promise } = connect(null)

    await expect(promise).rejects.toThrow(/token/i)
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(connection.state.value.status).toBe('failed')
  })

  it('puts the stream size in the URL', () => {
    connect()
    expect(socket().url).toContain('video_res_width=800')
    expect(socket().url).toContain('video_res_height=600')
  })

  it('sends the bearer token as a message, since a websocket cannot set headers', () => {
    const { connection } = connect()
    expect(connection.state.value.stage).toBe('websocket')

    socket().open()
    expect(socket().jsonSent()[0]).toEqual({
      type: 'headers',
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(connection.state.value.stage).toBe('authenticating')
  })

  it('negotiates a receive-only video stream once ICE servers arrive', async () => {
    const { connection } = connect()
    socket().open()
    socket().server({
      resp: {
        type: 'ice_server_info',
        data: { ice_servers: [{ urls: 'turn:x' }] },
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(connection.state.value.stage).toBe('negotiating')
    // Relay only, and a data channel opened as part of the same negotiation.
    expect(peer().configuration.iceTransportPolicy).toBe('relay')
    expect(peer().channels).toContain('unreliable_modeling_cmds')
    expect(peer().transceivers).toEqual([
      { kind: 'video', init: { direction: 'recvonly' } },
    ])
    expect(socket().jsonSent().at(-1)).toMatchObject({ type: 'sdp_offer' })
  })

  it('reaches connected when the track arrives', async () => {
    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    expect(connection.state.value.status).toBe('connected')
    expect(connection.state.value.stage).toBe('streaming')
    expect(connection.mediaStream.value).not.toBeNull()
  })

  it('applies an SDP answer once, ignoring a duplicate', async () => {
    const { promise } = connect()
    await completeHandshake()
    await promise

    const before = peer().remoteDescription
    socket().server({
      resp: {
        type: 'sdp_answer',
        data: { answer: { type: 'answer', sdp: 'v=0 second' } },
      },
    })
    await Promise.resolve()
    // Re-applying a description mid-session would tear down the live stream.
    expect(peer().remoteDescription).toBe(before)
  })

  it('trickles ICE candidates in both directions', async () => {
    connect()
    socket().open()
    socket().server({
      resp: { type: 'ice_server_info', data: { ice_servers: [] } },
    })
    await Promise.resolve()
    await Promise.resolve()

    peer().onicecandidate?.({
      candidate: { toJSON: () => ({ candidate: 'mine' }) },
    } as unknown as RTCPeerConnectionIceEvent)
    expect(socket().jsonSent()).toEqual(
      expect.arrayContaining([
        { type: 'trickle_ice', candidate: { candidate: 'mine' } },
      ])
    )

    socket().server({
      resp: {
        type: 'trickle_ice',
        data: { candidate: { candidate: 'theirs' } },
      },
    })
    await Promise.resolve()
    expect(peer().candidates).toEqual([{ candidate: 'theirs' }])
  })

  it('keeps connecting through a non-fatal protocol prompt', async () => {
    const { connection, promise } = connect()
    socket().open()

    // The live engine sends this the instant the socket opens, before it has
    // processed the headers we already sent. Treating it as a rejection tore the
    // connection down mid-handshake.
    socket().server({
      success: false,
      errors: [
        {
          error_code: 'wrong_protocol',
          message:
            'Please send `{ headers: { Authorization: "Bearer <token>" } }`',
        },
      ],
    })

    expect(connection.state.value.status).toBe('connecting')

    await completeHandshake()
    await promise
    expect(connection.state.value.status).toBe('connected')
  })

  it('names an auth failure instead of blaming the network', async () => {
    const { connection, promise } = connect()
    socket().open()
    socket().server({
      success: false,
      errors: [{ error_code: 'auth_token_invalid', message: 'bad token' }],
    })

    await expect(promise).rejects.toThrow()
    expect(connection.state.value.status).toBe('failed')
    expect(connection.state.value.error).toMatch(/credentials|expired/i)
  })

  it('reports latency from the ping/pong pair', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    // Pinging starts once the stream is live.
    vi.advanceTimersByTime(1_000)
    expect(socket().jsonSent()).toEqual(
      expect.arrayContaining([{ type: 'ping' }])
    )

    // Advancing the timers advances the mocked clock too, so this is the
    // elapsed time between ping and pong.
    vi.advanceTimersByTime(42)
    socket().server({ resp: { type: 'pong' } })
    expect(connection.state.value.pingMs).toBe(42)
  })

  it('never reports a negative latency, even if the clock jumps', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)

    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    vi.advanceTimersByTime(1_000)
    // A system clock correction between ping and pong.
    vi.setSystemTime(5_000)
    socket().server({ resp: { type: 'pong' } })

    expect(connection.state.value.pingMs).toBe(0)
  })

  it('keeps one ping outstanding at a time', async () => {
    vi.useFakeTimers()

    const { promise } = connect()
    await completeHandshake()
    await promise

    vi.advanceTimersByTime(3_000)
    const pings = socket()
      .jsonSent()
      .filter((message) => message.type === 'ping')
    // Without the guard, a stalled engine accumulates a ping per second and the
    // latency reading becomes meaningless.
    expect(pings).toHaveLength(1)
  })

  it('records the engine session id, which a bug report needs', async () => {
    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    socket().server({
      resp: {
        type: 'modeling_session_data',
        data: { session: { api_call_id: 'call-7' } },
      },
    })
    expect(connection.state.value.apiCallId).toBe('call-7')
  })

  it('answers a metrics request, so the engine is not left waiting', async () => {
    const { promise } = connect()
    await completeHandshake()
    await promise

    socket().server({ resp: { type: 'metrics_request', data: {} } })
    expect(socket().jsonSent()).toEqual(
      expect.arrayContaining([{ type: 'metrics_response', metrics: {} }])
    )
  })

  it('routes a command response to the caller that is waiting', async () => {
    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    const response = connection.send({
      id: 'cmd-1',
      sourceRange: [0, 0, 0],
      command: { type: 'zoom_to_fit' },
      idToSourceRange: {},
    })

    const sent = msgpackDecode(
      new Uint8Array(socket().binarySent()[0] as ArrayBuffer)
    ) as { cmd_id: string; type: string }
    expect(sent).toMatchObject({ type: 'modeling_cmd_req', cmd_id: 'cmd-1' })

    socket().binary({ request_id: 'cmd-1', success: true })
    // Resolved with the raw bytes: the Rust side deserialises msgpack itself.
    await expect(response).resolves.toBeInstanceOf(Uint8Array)
  })

  it('publishes a response that matches no pending request', async () => {
    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    const seen: Uint8Array[] = []
    connection.onUnmatchedResponse((bytes) => seen.push(bytes))

    // Fired commands still get answered, and KCL's runtime needs those replies.
    socket().binary({ request_id: 'not-ours', success: true })
    expect(seen).toHaveLength(1)
  })

  it('refuses to send while offline rather than dropping the command', () => {
    const connection = createEngineConnection({
      baseUrl: 'wss://engine.example.dev/ws',
      token: () => 'token',
    })

    expect(() =>
      connection.fire({
        id: 'cmd',
        sourceRange: [0, 0, 0],
        command: {},
        idToSourceRange: {},
      })
    ).toThrow(/not connected/i)
  })

  it('fails every pending command when the connection drops', async () => {
    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    const response = connection.send({
      id: 'cmd-1',
      sourceRange: [0, 0, 0],
      command: {},
      idToSourceRange: {},
    })

    socket().onclose?.({ reason: 'engine restarted' } as CloseEvent)
    // Leaving callers hanging on a socket that is gone is worse than failing.
    await expect(response).rejects.toThrow(/disconnected/i)
    expect(connection.state.value.status).toBe('failed')
  })

  it('goes back to offline on an explicit disconnect, not failed', async () => {
    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    connection.disconnect()
    expect(connection.state.value.status).toBe('offline')
    expect(connection.state.value.error).toBeNull()
    expect(connection.mediaStream.value).toBeNull()
  })

  it('does not report a failure for a socket closed after disconnecting', async () => {
    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    const live = socket()
    connection.disconnect()
    // The handler is detached on teardown, so a late close event is inert.
    live.onclose?.({ reason: 'late' } as CloseEvent)
    expect(connection.state.value.status).toBe('offline')
  })

  it('rejects a second concurrent connect attempt', async () => {
    const { connection } = connect()
    await expect(connection.connect()).rejects.toThrow(/already connecting/i)
  })

  it('resolves immediately when already connected', async () => {
    const { connection, promise } = connect()
    await completeHandshake()
    await promise

    await expect(connection.connect()).resolves.toBeUndefined()
  })
})
