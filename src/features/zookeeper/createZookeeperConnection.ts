import type {
  MlCopilotClientMessage,
  MlCopilotServerMessage,
} from '@kittycad/lib'
import { decode as msgpackDecode } from '@msgpack/msgpack'
import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { ZookeeperTransport } from '@src/contracts/zookeeper'

/** How long to wait for the service to assign a conversation before giving up. */
const CONNECT_TIMEOUT_MS = 120_000
/** How often to prove the socket is alive. */
const PING_INTERVAL_MS = 4_000
/** How long a `ping` may go unanswered. */
const PONG_TIMEOUT_MS = 30_000

/**
 * The close code the service uses when another client took the conversation.
 *
 * Worth naming rather than inlining, because the whole point is that this one is
 * **not** retryable — retrying is what makes two clients fight over a
 * conversation, each kicking the other off.
 */
const SUPERSEDED_CLOSE_CODE = 4409

export interface ZookeeperConnectionState {
  status: 'offline' | 'connecting' | 'connected' | 'failed'
  /**
   * How far into the handshake we are.
   *
   * Separate from `status` because "connected" is not one event: the socket opens,
   * then authentication is accepted, then a conversation is assigned. A UI that
   * only has `status` cannot tell a slow handshake from a hung one.
   */
  stage: 'websocket' | 'authenticating' | 'ready' | null
  error: string | null
  /** True when the conversation was taken over elsewhere. Do not reconnect. */
  superseded: boolean
  /** Assigned by the service; needed to resume this conversation later. */
  conversationId: string | null
}

export interface ZookeeperConnection extends ZookeeperTransport {
  readonly state: ReadonlySignal<ZookeeperConnectionState>
  /**
   * Open the socket and wait for a conversation to be assigned.
   *
   * Resolves when the service has named the conversation, which is the first
   * moment anything can usefully be sent. Rejects on failure, including the
   * connect deadline.
   */
  connect(options?: {
    conversationId?: string
    replay?: boolean
  }): Promise<void>
  disconnect(): void
  dispose(): void
}

export interface ZookeeperConnectionDependencies {
  /** Full websocket URL, from `zookeeperServiceUrl`. */
  url: string
  /**
   * Read the token at connect time, never captured once.
   *
   * The house pattern for authenticated calls on this branch: a token that was
   * read at construction is the token that has since been refreshed.
   */
  token: () => string | null
}

/**
 * One websocket to the Zookeeper service, for one conversation.
 *
 * Shaped after `createEngineConnection`, deliberately: status and stage as
 * signals, one `fail()` funnel, teardown before connect, a connect watchdog, and
 * handlers nulled before closing so a deliberate teardown is not read as a
 * failure. That connection is the app's only other long-lived socket and its
 * shape has already been through the mill.
 *
 * **One socket per conversation, not one multiplexed.** The protocol is already
 * conversation-scoped — resuming is `?conversation_id=…`, and no message carries
 * a client-minted conversation id — so multiplexing would mean inventing an
 * identifier the wire cannot carry. `backend_shutdown`, close code 4409 and
 * `access_denied` are also per-conversation facts, and a shared socket would let
 * one conversation's billing denial take out the others.
 *
 * Reconnection is the caller's decision, again as with the engine. Nothing here
 * retries on its own, and the one case where retrying would be actively harmful
 * is called out below.
 */
export function createZookeeperConnection(
  dependencies: ZookeeperConnectionDependencies
): ZookeeperConnection {
  const { url, token } = dependencies

  const state = signal<ZookeeperConnectionState>({
    status: 'offline',
    stage: null,
    error: null,
    superseded: false,
    conversationId: null,
  })

  const listeners = new Set<(message: MlCopilotServerMessage) => void>()

  let socket: WebSocket | null = null
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  let resolveConnect: (() => void) | null = null
  let rejectConnect: ((error: Error) => void) | null = null
  /**
   * A reason the service gave us before the socket closed.
   *
   * `backend_shutdown` is a *message*, so it arrives while things still work. Kept
   * so `onclose` does not overwrite a specific reason with a generic one.
   */
  let announcedReason: string | null = null

  const patch = (change: Partial<ZookeeperConnectionState>) => {
    state.value = { ...state.peek(), ...change }
  }

  function teardown() {
    clearTimeout(connectTimer)
    clearInterval(pingTimer)
    clearTimeout(pongTimer)
    connectTimer = undefined
    pingTimer = undefined
    pongTimer = undefined

    if (socket) {
      // Handlers first: closing fires `onclose`, which would otherwise be read
      // as the connection failing rather than as us ending it.
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close()
      }
      socket = null
    }
  }

  function fail(message: string, options: { superseded?: boolean } = {}) {
    if (state.peek().status === 'failed') return

    patch({
      status: 'failed',
      stage: null,
      error: message,
      ...(options.superseded === true ? { superseded: true } : {}),
    })

    rejectConnect?.(new Error(message))
    rejectConnect = null
    resolveConnect = null

    teardown()
  }

  const publish = (message: MlCopilotServerMessage) => {
    for (const listener of [...listeners]) {
      try {
        listener(message)
      } catch (error) {
        // One bad observer must not take down the socket that fed it.
        console.error('zookeeper: message listener threw', error)
      }
    }
  }

  const armPong = () => {
    /*
     * Only the *first* unanswered ping starts the clock, and only a `pong` stops
     * it. Re-arming on every ping was the original mistake and it is invisible
     * without a test: pings go out every few seconds, so each one would push the
     * deadline out again and a socket that had stopped answering entirely would
     * never be declared dead.
     */
    if (pongTimer !== undefined) return
    pongTimer = setTimeout(() => {
      fail(
        `The service did not answer a ping within ${PONG_TIMEOUT_MS / 1000}s.`
      )
    }, PONG_TIMEOUT_MS)
  }

  const startHeartbeat = () => {
    clearInterval(pingTimer)
    pingTimer = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'ping' }))
      armPong()
    }, PING_INTERVAL_MS)
  }

  function handleFrame(data: unknown) {
    let message: MlCopilotServerMessage
    try {
      /*
       * The service answers in JSON *or* binary MessagePack, and which is not
       * negotiated — so both are decoded rather than one being assumed.
       */
      if (typeof data === 'string') {
        message = JSON.parse(data) as MlCopilotServerMessage
      } else if (data instanceof ArrayBuffer) {
        message = msgpackDecode(new Uint8Array(data)) as MlCopilotServerMessage
      } else {
        return
      }
    } catch (error) {
      console.error('zookeeper: could not decode a frame', error)
      return
    }

    // A `pong` is proof of life and nothing else; it never reaches a listener.
    if ('pong' in message) {
      clearTimeout(pongTimer)
      pongTimer = undefined
      return
    }

    if ('conversation_id' in message) {
      /*
       * The handshake is only over now. `main` says the same thing in a comment:
       * a socket that is open but has no conversation cannot be sent a prompt.
       */
      clearTimeout(connectTimer)
      connectTimer = undefined
      patch({
        status: 'connected',
        stage: 'ready',
        conversationId: message.conversation_id.conversation_id,
      })
      resolveConnect?.()
      resolveConnect = null
      rejectConnect = null
      startHeartbeat()
    }

    if ('backend_shutdown' in message) {
      // Recorded, not acted on: the close will follow, and this is the only
      // place a *reason* is available.
      announcedReason =
        message.backend_shutdown.reason ?? 'The service shut down.'
    }

    if ('access_denied' in message) {
      publish(message)
      fail(message.access_denied.detail)
      return
    }

    publish(message)
  }

  function connect(
    options: { conversationId?: string; replay?: boolean } = {}
  ): Promise<void> {
    const current = state.peek()
    if (current.status === 'connected') return Promise.resolve()
    if (current.status === 'connecting') {
      return Promise.reject(new Error('Already connecting.'))
    }

    const bearer = token()
    if (bearer === null || bearer === '') {
      return Promise.reject(new Error('Not signed in.'))
    }

    // Teardown first, unconditionally: a previous failed attempt may have left a
    // socket half-open, and connecting on top of it leaks the old one.
    teardown()
    announcedReason = null
    patch({
      status: 'connecting',
      stage: 'websocket',
      error: null,
      superseded: false,
    })

    const target = new URL(url)
    if (options.conversationId !== undefined) {
      target.searchParams.set('conversation_id', options.conversationId)
      // Only meaningful alongside a conversation to replay.
      if (options.replay === true) target.searchParams.set('replay', 'true')
    }

    return new Promise<void>((resolve, reject) => {
      resolveConnect = resolve
      rejectConnect = reject

      connectTimer = setTimeout(() => {
        fail(
          `The service did not assign a conversation within ${
            CONNECT_TIMEOUT_MS / 1000
          }s.`
        )
      }, CONNECT_TIMEOUT_MS)

      const opened = new WebSocket(target.toString())
      socket = opened
      opened.binaryType = 'arraybuffer'

      opened.onopen = () => {
        patch({ stage: 'authenticating' })
        /*
         * Authentication is a *message*, not a header: a browser cannot set
         * headers on a websocket handshake. Same reason the engine does it this
         * way.
         */
        opened.send(
          JSON.stringify({
            type: 'headers',
            headers: { Authorization: `Bearer ${bearer}` },
          })
        )
      }

      opened.onmessage = (event) => handleFrame(event.data)

      opened.onerror = () => fail(announcedReason ?? 'The connection failed.')

      opened.onclose = (event) => {
        /*
         * Read the code *before* failing. The engine's handler only looks at
         * `reason`, which is the one place this connection genuinely needs more
         * than the template: a superseded conversation must not be retried,
         * because retrying is what makes two clients kick each other off in a
         * loop.
         */
        if (event.code === SUPERSEDED_CLOSE_CODE) {
          fail('This conversation was opened somewhere else.', {
            superseded: true,
          })
          return
        }
        fail(announcedReason ?? 'The connection closed.')
      }
    })
  }

  return {
    state: computed(() => state.value),

    connect,

    send(message: MlCopilotClientMessage) {
      if (socket?.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify(message))
    },

    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    disconnect() {
      teardown()
      patch({ status: 'offline', stage: null, error: null })
    },

    dispose() {
      teardown()
      listeners.clear()
      patch({ status: 'offline', stage: null })
    },
  }
}
