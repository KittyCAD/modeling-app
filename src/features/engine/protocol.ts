/**
 * The engine websocket protocol, as data.
 *
 * Kept apart from the connection so the message handling can be tested without
 * a socket, a peer connection, or a network. Everything here is pure.
 */

/** Client-to-server messages this app sends. */
export type EngineClientMessage =
  | { type: 'headers'; headers: Record<string, string> }
  | { type: 'ping' }
  | { type: 'sdp_offer'; offer: RTCSessionDescriptionInit }
  | { type: 'trickle_ice'; candidate: RTCIceCandidateInit }
  | { type: 'metrics_response'; metrics: unknown }

/** The server-to-client messages this app acts on. */
export interface EngineServerMessage {
  success?: boolean
  errors?: { error_code?: string; message?: string }[]
  resp?: {
    type: string
    data?: Record<string, unknown>
  }
}

export interface EngineError {
  code: string
  message: string
}

/**
 * Read an error out of a server message.
 *
 * Returns null for a successful message. Auth failures matter most: without
 * naming `auth_token_invalid` specifically, an expired token looks like a
 * generic connection problem and sends people to check their network.
 */
export function errorFromMessage(
  message: EngineServerMessage
): EngineError | null {
  if (message.success !== false) return null

  const first = message.errors?.[0]
  return {
    code: first?.error_code ?? 'unknown',
    message: first?.message ?? 'The engine rejected the connection.',
  }
}

export function isAuthError(error: EngineError): boolean {
  return (
    error.code === 'auth_token_invalid' ||
    error.code === 'unauthorized' ||
    error.code === 'forbidden'
  )
}

/**
 * The engine's websocket URL for a given stream size.
 *
 * Dimensions are part of the URL because the engine allocates its render target
 * at connection time; resizing later means reconnecting.
 */
export function engineWebSocketUrl(input: {
  baseUrl: string
  width: number
  height: number
}): string {
  const separator = input.baseUrl.includes('?') ? '&' : '?'
  const query = new URLSearchParams({
    video_res_width: String(clampDimension(input.width)),
    video_res_height: String(clampDimension(input.height)),
    post_effect: 'ssao',
  })
  return `${input.baseUrl}${separator}${query.toString()}`
}

/** The engine's stream constraints. Violating any of them closes the socket. */
export const MIN_STREAM_DIMENSION = 256
export const MAX_STREAM_DIMENSION = 2160
/** Dimensions must be multiples of this. Merely being even is not enough. */
export const STREAM_DIMENSION_FACTOR = 4

/**
 * Keep a requested stream size within what the engine will accept.
 *
 * Three separate constraints, and the engine enforces them by *closing the
 * connection* rather than clamping — so getting any of them wrong presents as an
 * outage with no explanation:
 *
 * - finite and positive. Measuring an element before layout yields 0.
 * - within [256, 2160].
 * - a multiple of 4. This is the one that bit: an even number is not enough, and
 *   a 594px-wide panel produced a size the engine silently refused.
 */
export function clampDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MIN_STREAM_DIMENSION

  const rounded =
    Math.round(value / STREAM_DIMENSION_FACTOR) * STREAM_DIMENSION_FACTOR

  return Math.min(Math.max(rounded, MIN_STREAM_DIMENSION), MAX_STREAM_DIMENSION)
}

/** Peer-connection configuration, given whatever ICE servers we were handed. */
export function peerConfiguration(
  iceServers: RTCIceServer[]
): RTCConfiguration {
  if (iceServers.length === 0) return { bundlePolicy: 'max-bundle' }

  return {
    bundlePolicy: 'max-bundle',
    iceServers,
    // Always relay. The engine's topology is known and direct connections are
    // not something we want to negotiate.
    iceTransportPolicy: 'relay',
  }
}

/** Normalise an SDP answer, which arrives with a loosely-typed `type`. */
export function toSessionDescription(
  answer: unknown
): RTCSessionDescriptionInit | null {
  if (!answer || typeof answer !== 'object') return null
  const candidate = answer as { type?: string; sdp?: string }
  if (!candidate.sdp || !candidate.type || candidate.type === 'unspecified') {
    return null
  }
  return {
    type: candidate.type as RTCSdpType,
    sdp: candidate.sdp,
  }
}
