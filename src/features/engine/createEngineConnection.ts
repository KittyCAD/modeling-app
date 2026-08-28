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
import type { ModelingCommandRequest } from '@src/wasm/bridge'
import {
  type EngineServerMessage,
  clampDimension,
  engineWebSocketUrl,
  errorFromMessage,
  isAuthError,
  peerConfiguration,
  toSessionDescription,
} from '@src/features/engine/protocol'

const PING_INTERVAL_MS = 1_000
/** Long enough for a cold engine to start; short enough to not look hung. */
const CONNECT_TIMEOUT_MS = 30_000
/** A command the engine never answers must not leak a pending promise forever. */
const COMMAND_TIMEOUT_MS = 60_000
const UNRELIABLE_CHANNEL = 'unreliable_modeling_cmds'

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
    pingTimer = undefined
    connectTimer = undefined
    pingSentAt = null

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

  /** A binary frame is a modelling response. Route it or publish it. */
  function handleBinaryMessage(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer)

    let requestId: string | undefined
    try {
      const decoded = msgpackDecode(bytes) as { request_id?: string }
      requestId = decoded?.request_id
    } catch {
      // Undecodable frames are still forwarded: KCL's runtime may understand a
      // shape this app does not.
    }

    const command = requestId ? pending.get(requestId) : undefined
    if (command) {
      window.clearTimeout(command.timer)
      pending.delete(requestId as string)
      // Resolved with the original bytes, not the decoded object: the Rust side
      // deserialises msgpack itself.
      command.resolve(bytes)
      return
    }

    for (const listener of unmatchedListeners) {
      try {
        listener(bytes)
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
   * The wire form of a modelling command.
   *
   * Copied into a plain `ArrayBuffer` because msgpack may hand back a view over
   * a pooled or shared buffer, and `WebSocket.send` will not take one.
   */
  function encodeCommand(request: ModelingCommandRequest): ArrayBuffer {
    const encoded = msgpackEncode({
      type: 'modeling_cmd_req',
      cmd: request.command,
      cmd_id: request.id,
    })
    return encoded.slice().buffer as ArrayBuffer
  }

  return {
    state,
    mediaStream: computed(() => mediaStream.value),
    viewportSize: computed(() => viewportSize.value),

    reportViewportSize(size) {
      const next = {
        width: clampDimension(size.width),
        height: clampDimension(size.height),
      }
      if (
        next.width === viewportSize.peek().width &&
        next.height === viewportSize.peek().height
      ) {
        return
      }
      viewportSize.value = next
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

        const size = dimensions ?? viewportSize.peek()
        socket = new WebSocket(
          engineWebSocketUrl({
            baseUrl: options.baseUrl,
            width: size.width,
            height: size.height,
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
          if (event.data instanceof ArrayBuffer) {
            handleBinaryMessage(event.data)
            return
          }
          try {
            handleServerMessage(JSON.parse(String(event.data)))
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

    fire(request) {
      const open = requireOpenSocket()
      open.send(encodeCommand(request))
    },

    send(request) {
      const open = requireOpenSocket()

      return new Promise<Uint8Array>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(request.id)
          reject(
            new Error(
              `The engine did not answer command ${request.id} within ${COMMAND_TIMEOUT_MS / 1000}s.`
            )
          )
        }, COMMAND_TIMEOUT_MS)

        pending.set(request.id, { resolve, reject, timer })
        try {
          open.send(encodeCommand(request))
        } catch (caught) {
          window.clearTimeout(timer)
          pending.delete(request.id)
          reject(caught instanceof Error ? caught : new Error(String(caught)))
        }
      })
    },

    async startNewSession() {
      // A fresh scene is what a new connection already gives, so reconnecting is
      // both the simplest and the most reliable reset.
      if (status.peek() === 'connected') this.disconnect()
      await this.connect()
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
