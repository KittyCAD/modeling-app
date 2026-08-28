import {
  decode as msgpackDecode,
  encode as msgpackEncode,
} from '@msgpack/msgpack'
import { computed, signal } from '@preact/signals'
import type {
  EngineConnection,
  EngineConnectionStage,
  EngineConnectionState,
} from '@src/contracts/engine'
import {
  clampDimension,
  type EngineServerMessage,
  engineWebSocketUrl,
  streamDimensionsFor,
  errorFromMessage,
  isAuthError,
  peerConfiguration,
  toSessionDescription,
} from '@src/features/engine/protocol'
import type { ModelingCommandRequest } from '@src/wasm/bridge'

const PING_INTERVAL_MS = 1_000
/** Long enough for a cold engine to start; short enough to not look hung. */
const CONNECT_TIMEOUT_MS = 30_000
/** A command the engine never answers must not leak a pending promise forever. */
const COMMAND_TIMEOUT_MS = 60_000
const UNRELIABLE_CHANNEL = 'unreliable_modeling_cmds'

/**
 * Responses that belong to the connection rather than to a modelling command.
 *
 * Matched by name because the engine attaches a `request_id` to these as well,
 * so there is no structural way to tell them apart.
 */
const PROTOCOL_RESPONSE_TYPES = new Set([
  'pong',
  'ice_server_info',
  'sdp_answer',
  'trickle_ice',
  'metrics_request',
  'modeling_session_data',
])

/**
 * How long a burst of resizes is allowed to run before the stream is resized.
 *
 * Dragging a splitter reports a size on every frame. The engine reallocates its
 * render target for each reconfigure, so following the pointer would mean dozens
 * of reallocations and a stream that flickers all the way through the drag.
 */
const RESIZE_SETTLE_MS = 250

/**
 * ...but a single discrete change should not wait.
 *
 * Toggling a pane or maximising the window is one resize, not a burst, and
 * waiting a quarter of a second to answer it looks broken. The first report
 * after a quiet period goes immediately; the settle timer covers what follows.
 */
const RESIZE_LEADING_MS = 150

interface PendingCommand {
  resolve: (bytes: Uint8Array) => void
  reject: (error: Error) => void
  timer: number
}

export interface EngineConnectionOptions {
  /** The engine's websocket base URL. */
  baseUrl: string
  /** Bearer token, read at connect time so a later sign-in is picked up. */
  token: () => string | null
  /**
   * Query parameters for the stream, read at connect time.
   *
   * A function rather than a value because the scene's preferences can change
   * between one connection and the next, and the connection is created once at
   * startup.
   */
  streamParams?: () => Record<string, string>
}

/**
 * The connection to the modelling engine.
 *
 * The scene is rendered on the engine and streamed back as video, so this owns
 * both a websocket (commands, and the WebRTC signalling) and a peer connection
 * (the video track). The handshake is fixed by the server:
 *
 *   1. open the websocket, then send `headers` with the bearer token
 *   2. `ice_server_info` arrives — which is also the signal that auth succeeded
 *   3. build the peer connection, add a recvonly video transceiver, offer
 *   4. `sdp_answer` arrives, set it as the remote description
 *   5. `trickle_ice` flows both ways until the track arrives
 *
 * Deliberately not a state machine object: the states are few and the
 * transitions are driven entirely by inbound messages, so a status signal and a
 * stage signal say everything a machine would, and can be read directly by the
 * status bar.
 */
export function createEngineConnection(
  options: EngineConnectionOptions
): EngineConnection & { dispose: () => void } {
  const status = signal<EngineConnectionState['status']>('offline')
  const stage = signal<EngineConnectionStage | null>(null)
  const error = signal<string | null>(null)
  const pingMs = signal<number | null>(null)
  const apiCallId = signal<string | null>(null)
  /** Bumped whenever the engine begins a fresh scene. */
  const sceneEpoch = signal(0)

  /**
   * The size the engine is actually rendering at.
   *
   * Tracked separately from `viewportSize`, which is what the app has asked for.
   * Keeping both is what lets them be reconciled at any moment — including after
   * a resize that happened while the socket was still negotiating, when there was
   * nothing to tell.
   */
  let appliedSize: { width: number; height: number } | null = null
  let resizeTimer: number | undefined
  let lastResizeAt: number | null = null
  const mediaStream = signal<MediaStream | null>(null)
  /**
   * The size the next connection asks for.
   *
   * Defaults to something the engine will accept, so connecting before anything
   * has measured the viewport still works.
   */
  const viewportSize = signal({ width: 1024, height: 1024 })

  let socket: WebSocket | null = null
  let peer: RTCPeerConnection | null = null
  let unreliableChannel: RTCDataChannel | null = null
  let pingTimer: number | undefined
  let pingSentAt: number | null = null
  let connectTimer: number | undefined
  let sdpAnswerApplied = false
  /** The most recent non-fatal engine complaint, for a timeout message. */
  let lastWarning: string | null = null

  const pending = new Map<string, PendingCommand>()
  const unmatchedListeners = new Set<(bytes: Uint8Array) => void>()

  let resolveConnect: (() => void) | null = null
  let rejectConnect: ((error: Error) => void) | null = null

  const state = computed<EngineConnectionState>(() => ({
    status: status.value,
    stage: stage.value,
    error: error.value,
    pingMs: pingMs.value,
    apiCallId: apiCallId.value,
  }))

  function sendJson(message: unknown) {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(message))
  }

  function fail(message: string) {
    if (status.peek() === 'failed') return
    status.value = 'failed'
    error.value = message
    stage.value = null

    rejectConnect?.(new Error(message))
    rejectConnect = null
    resolveConnect = null

    // Every waiting command is now unanswerable; failing them beats leaving
    // callers hanging on a socket that is gone.
    for (const [id, command] of pending) {
      window.clearTimeout(command.timer)
      command.reject(new Error(`Engine disconnected: ${message}`))
      pending.delete(id)
    }

    teardown()
  }

  function teardown() {
    window.clearInterval(pingTimer)
    window.clearTimeout(connectTimer)
    window.clearTimeout(resizeTimer)
    pingTimer = undefined
    connectTimer = undefined
    resizeTimer = undefined
    pingSentAt = null
    // The next connection carries the size in its URL, so nothing is pending.
    appliedSize = null
    lastResizeAt = null

    unreliableChannel?.close()
    unreliableChannel = null

    // Removing the handlers first: closing a peer connection fires state
    // changes that would otherwise be read as a failure.
    if (peer) {
      peer.onicecandidate = null
      peer.ontrack = null
      peer.onconnectionstatechange = null
      peer.close()
      peer = null
    }

    if (socket) {
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

    mediaStream.value = null
    sdpAnswerApplied = false
  }

  function startPinging() {
    window.clearInterval(pingTimer)
    pingTimer = window.setInterval(() => {
      // One outstanding ping at a time; the answer is the latency measurement.
      if (pingSentAt !== null) return
      pingSentAt = Date.now()
      sendJson({ type: 'ping' })
    }, PING_INTERVAL_MS)
  }

  /**
   * Route one decoded message.
   *
   * Modelling responses carry a `request_id`; protocol messages do not. The
   * engine sends responses as msgpack binary *or* as JSON depending on the
   * message, so both are decoded to an object first and then re-encoded as
   * msgpack for the Rust side — which deserialises msgpack and cannot take the
   * raw JSON text a response may have arrived as.
   */
  function routeMessage(
    message: EngineServerMessage & { request_id?: string }
  ) {
    // Protocol messages are recognised by their response type, *before* the
    // request-id check: the engine stamps a `request_id` on those too, so
    // routing by id first misroutes the entire handshake and the connection
    // simply never completes.
    const responseType = message.resp?.type
    if (responseType && PROTOCOL_RESPONSE_TYPES.has(responseType)) {
      handleServerMessage(message)
      return
    }

    const requestId = message.request_id
    if (!requestId) {
      handleServerMessage(message)
      return
    }

    const command = pending.get(requestId)
    const failure = message.success === false

    if (command) {
      window.clearTimeout(command.timer)
      pending.delete(requestId)

      if (failure) {
        // Rejected with the whole failure response: the Rust side parses it as
        // a `FailureWebSocketResponse` to recover the engine's own messages.
        command.reject(new Error(JSON.stringify(message)))
        return
      }
      command.resolve(msgpackEncode(message).slice())
      return
    }

    // A reply to something that was fired rather than awaited. KCL's runtime is
    // tracking those, so dropping them would leave it waiting forever.
    const encoded = msgpackEncode(message).slice()
    for (const listener of unmatchedListeners) {
      try {
        listener(encoded)
      } catch (caught) {
        console.error('engine: unmatched-response listener threw', caught)
      }
    }
  }

  function handleServerMessage(message: EngineServerMessage) {
    const failure = errorFromMessage(message)
    if (failure) {
      // Only auth failures are fatal. The engine also uses this shape for
      // protocol *prompts* — notably "please send Authorization over this
      // websocket", which arrives the instant the socket opens, before it has
      // processed the headers message we already sent. Treating that as a
      // rejection tore the connection down mid-handshake.
      if (isAuthError(failure)) {
        fail(
          'The engine rejected these credentials. The token may have expired.'
        )
        return
      }

      // Anything else is recorded and ignored; a genuinely stuck connection is
      // caught by the connect timeout, which reports the last thing said.
      lastWarning = failure.message
      console.warn(`engine: ${failure.message}`)
      return
    }

    const response = message.resp
    if (!response?.type) return

    switch (response.type) {
      case 'pong': {
        if (pingSentAt !== null) {
          // Clamped at both ends: capped so the status field cannot widen, and
          // floored because a system clock adjustment mid-flight would
          // otherwise report a negative latency.
          const elapsed = Date.now() - pingSentAt
          pingMs.value = Math.min(999, Math.max(0, elapsed))
          pingSentAt = null
        }
        return
      }

      case 'modeling_session_data': {
        const session = (
          response.data as { session?: { api_call_id?: string } }
        )?.session
        apiCallId.value = session?.api_call_id ?? null
        return
      }

      // Only sent after successful authentication, so this doubles as the
      // "credentials accepted" signal.
      case 'ice_server_info': {
        stage.value = 'negotiating'
        void beginPeerConnection(
          ((response.data as { ice_servers?: RTCIceServer[] })?.ice_servers ??
            []) as RTCIceServer[]
        )
        return
      }

      case 'sdp_answer': {
        const answer = toSessionDescription(
          (response.data as { answer?: unknown })?.answer
        )
        if (!answer || !peer || sdpAnswerApplied) return

        sdpAnswerApplied = true
        peer.setRemoteDescription(answer).catch((caught) => {
          fail(
            caught instanceof Error
              ? caught.message
              : 'Could not apply the engine session description.'
          )
        })
        return
      }

      case 'trickle_ice': {
        const candidate = (response.data as { candidate?: RTCIceCandidateInit })
          ?.candidate
        if (candidate && peer) {
          // A candidate arriving before the remote description is normal, and
          // the browser queues it; a rejection here is not worth failing over.
          peer.addIceCandidate(candidate).catch(() => {})
        }
        return
      }

      case 'metrics_request': {
        // The engine adapts stream quality from these. Nothing collected yet, so
        // an empty response keeps it from waiting on us.
        sendJson({ type: 'metrics_response', metrics: {} })
        return
      }
    }
  }

  async function beginPeerConnection(iceServers: RTCIceServer[]) {
    try {
      peer = new RTCPeerConnection(peerConfiguration(iceServers))

      // Opened before the offer, so it is part of the negotiation rather than a
      // second round-trip. Used for high-frequency commands that tolerate loss.
      unreliableChannel = peer.createDataChannel(UNRELIABLE_CHANNEL)

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          sendJson({ type: 'trickle_ice', candidate: event.candidate.toJSON() })
        }
      }

      peer.ontrack = (event) => {
        mediaStream.value = event.streams[0] ?? new MediaStream([event.track])
        stage.value = 'streaming'
        status.value = 'connected'
        // A fresh connection is a fresh scene: whatever the app had told the
        // engine about how to draw it is gone, and has to be restated.
        sceneEpoch.value += 1
        // The panel may have been resized while the socket was negotiating,
        // when there was nothing to tell. No-ops when the size still matches.
        scheduleReconfigure()
        error.value = null
        window.clearTimeout(connectTimer)
        startPinging()
        resolveConnect?.()
        resolveConnect = null
        rejectConnect = null
      }

      peer.onconnectionstatechange = () => {
        if (
          peer?.connectionState === 'failed' ||
          peer?.connectionState === 'closed'
        ) {
          fail('The engine connection dropped.')
        }
      }

      // Receive-only: the engine renders, we display.
      peer.addTransceiver('video', { direction: 'recvonly' })

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      sendJson({ type: 'sdp_offer', offer })
    } catch (caught) {
      fail(
        caught instanceof Error
          ? caught.message
          : 'Could not negotiate a video stream with the engine.'
      )
    }
  }

  function requireOpenSocket(): WebSocket {
    if (socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to the modeling engine.')
    }
    return socket
  }

  /**
   * The id the engine will echo back as `request_id`.
   *
   * That is the envelope's `cmd_id`, not whatever the caller happened to pass
   * alongside it. Keying the pending map on the caller's id works only while the
   * two agree, and a response that arrives under a different id looks exactly
   * like a command the engine never answered.
   */
  function correlationId(request: ModelingCommandRequest): string {
    const envelope = request.command as { cmd_id?: unknown } | null
    return typeof envelope?.cmd_id === 'string' ? envelope.cmd_id : request.id
  }

  /**
   * The wire form of a modelling command: JSON text, sent as-is.
   *
   * `request.command` is already a complete `WebSocketRequest` — the Rust side
   * serialises the whole envelope, not a bare command — so wrapping it again
   * produces a message the engine accepts and then never answers, which
   * presents as execution hanging rather than as an error.
   */
  function encodeCommand(request: ModelingCommandRequest): string {
    return JSON.stringify(request.command)
  }

  /**
   * Tell the engine the stream has a new size.
   *
   * Silent unless there is something to tell: not connected, or the engine is
   * already rendering at this size. `fps` is required by the command and,
   * according to the existing app, does next to nothing.
   */
  function sendReconfigure(): void {
    resizeTimer = undefined
    if (status.peek() !== 'connected') return

    const wanted = viewportSize.peek()
    if (
      appliedSize &&
      appliedSize.width === wanted.width &&
      appliedSize.height === wanted.height
    ) {
      return
    }

    const commandId = crypto.randomUUID()
    try {
      const open = requireOpenSocket()
      open.send(
        encodeCommand({
          id: commandId,
          sourceRange: [0, 0, 0],
          command: {
            type: 'modeling_cmd_req',
            cmd_id: commandId,
            cmd: { type: 'reconfigure_stream', ...wanted, fps: 60 },
          },
          idToSourceRange: {},
        })
      )
      appliedSize = wanted
      lastResizeAt = Date.now()
    } catch (caught) {
      // The socket closed between the status read and the send. The next
      // connection carries the size in its URL, so nothing is lost.
      console.warn('engine: could not resize the stream', caught)
    }
  }

  /**
   * Leading edge, then a settle.
   *
   * One discrete change — a pane toggled, a window maximised — is answered
   * immediately. A drag, which reports on every frame, is answered once at the
   * size it ends on.
   */
  function scheduleReconfigure(): void {
    if (status.peek() !== 'connected') return

    const quiet =
      lastResizeAt === null || Date.now() - lastResizeAt >= RESIZE_LEADING_MS
    if (quiet && resizeTimer === undefined) {
      sendReconfigure()
      return
    }

    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(sendReconfigure, RESIZE_SETTLE_MS)
  }

  return {
    state,
    mediaStream: computed(() => mediaStream.value),
    viewportSize: computed(() => viewportSize.value),

    reportViewportSize(size) {
      // A collapsed pane measures zero. Reconfiguring the stream down to the
      // minimum for something nobody can see costs a round trip and another one
      // when it reopens, so the last real size is kept instead.
      if (size.width <= 0 || size.height <= 0) return

      const next = streamDimensionsFor(size.width, size.height)
      if (
        next.width === viewportSize.peek().width &&
        next.height === viewportSize.peek().height
      ) {
        return
      }
      viewportSize.value = next
      scheduleReconfigure()
    },

    connect(dimensions) {
      if (status.peek() === 'connected') return Promise.resolve()
      if (status.peek() === 'connecting') {
        return Promise.reject(new Error('Already connecting.'))
      }

      const token = options.token()
      if (!token) {
        const message =
          'No API token available, so the engine cannot be reached.'
        status.value = 'failed'
        error.value = message
        return Promise.reject(new Error(message))
      }
      if (!options.baseUrl) {
        const message = 'No engine websocket URL is configured.'
        status.value = 'failed'
        error.value = message
        return Promise.reject(new Error(message))
      }

      teardown()
      status.value = 'connecting'
      stage.value = 'websocket'
      error.value = null
      lastWarning = null
      pingMs.value = null
      apiCallId.value = null

      return new Promise<void>((resolve, reject) => {
        resolveConnect = resolve
        rejectConnect = reject

        connectTimer = window.setTimeout(() => {
          fail(
            `The engine did not respond within ${CONNECT_TIMEOUT_MS / 1000}s.`
          )
        }, CONNECT_TIMEOUT_MS)

        /**
         * One source of truth for the size.
         *
         * Dimensions passed here are adopted rather than used and forgotten.
         * Using them for the URL while `viewportSize` still held something else
         * left the connection contradicting itself: it opened at one size and
         * then immediately resized the stream to the other.
         */
        if (dimensions) {
          viewportSize.value = streamDimensionsFor(
            dimensions.width,
            dimensions.height
          )
        }
        const size = viewportSize.peek()
        // What the engine will render at, from the moment the socket opens. The
        // panel can change size during negotiation, and this is what makes that
        // detectable rather than silently wrong.
        appliedSize = size
        socket = new WebSocket(
          engineWebSocketUrl({
            baseUrl: options.baseUrl,
            width: size.width,
            height: size.height,
            params: options.streamParams?.(),
          })
        )
        socket.binaryType = 'arraybuffer'

        socket.onopen = () => {
          stage.value = 'authenticating'
          // The token goes in a message, not a header: browsers cannot set
          // headers on a websocket handshake.
          sendJson({
            type: 'headers',
            headers: { Authorization: `Bearer ${token}` },
          })
        }

        socket.onmessage = (event) => {
          try {
            routeMessage(
              event.data instanceof ArrayBuffer
                ? (msgpackDecode(new Uint8Array(event.data)) as never)
                : JSON.parse(String(event.data))
            )
          } catch (caught) {
            console.warn('engine: could not read a server message', caught)
          }
        }

        socket.onerror = () => {
          fail('The engine websocket failed.')
        }

        socket.onclose = (event) => {
          if (status.peek() === 'connected' || status.peek() === 'connecting') {
            fail(
              event.reason
                ? `The engine closed the connection: ${event.reason}`
                : 'The engine closed the connection.'
            )
          }
        }
      })
    },

    disconnect() {
      teardown()
      status.value = 'offline'
      stage.value = null
      error.value = null
      pingMs.value = null
      apiCallId.value = null
    },

    sceneEpoch: computed(() => sceneEpoch.value),

    fireCommand(cmd) {
      const commandId = crypto.randomUUID()
      try {
        this.fire({
          id: commandId,
          sourceRange: [0, 0, 0],
          command: { type: 'modeling_cmd_req', cmd_id: commandId, cmd },
          idToSourceRange: {},
        })
      } catch (caught) {
        // The socket can close between a status read and this send. A scene
        // command describes a scene that is gone, so there is nothing to report.
        console.warn(`engine: could not send ${cmd.type}`, caught)
      }
    },

    sendCommand(cmd) {
      const commandId = crypto.randomUUID()
      return this.send({
        id: commandId,
        sourceRange: [0, 0, 0],
        command: { type: 'modeling_cmd_req', cmd_id: commandId, cmd },
        idToSourceRange: {},
      })
    },

    fire(request) {
      const open = requireOpenSocket()
      open.send(encodeCommand(request))
    },

    send(request) {
      const open = requireOpenSocket()
      const id = correlationId(request)

      return new Promise<Uint8Array>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(id)
          reject(
            new Error(
              `The engine did not answer command ${id} within ${COMMAND_TIMEOUT_MS / 1000}s.`
            )
          )
        }, COMMAND_TIMEOUT_MS)

        pending.set(id, { resolve, reject, timer })
        try {
          open.send(encodeCommand(request))
        } catch (caught) {
          window.clearTimeout(timer)
          pending.delete(id)
          reject(caught instanceof Error ? caught : new Error(String(caught)))
        }
      })
    },

    async startNewSession() {
      /**
       * Clear per-session command state. Deliberately *not* a reconnect.
       *
       * KCL's runtime calls this at the start of every execution, so
       * reconnecting here tore down a perfectly good connection — and, mid
       * negotiation, killed the connection that the execution was waiting on.
       * The scene reset belongs to the execution context; all this owes is a
       * clean slate for command routing.
       */
      for (const [id, command] of pending) {
        window.clearTimeout(command.timer)
        command.reject(new Error('The engine session was restarted.'))
        pending.delete(id)
      }

      // Only connect if there is nothing there; never replace what is working.
      if (status.peek() === 'offline' || status.peek() === 'failed') {
        await this.connect()
      }
    },

    onUnmatchedResponse(listener) {
      unmatchedListeners.add(listener)
      return () => unmatchedListeners.delete(listener)
    },

    dispose() {
      teardown()
      unmatchedListeners.clear()
      status.value = 'offline'
    },
  }
}
