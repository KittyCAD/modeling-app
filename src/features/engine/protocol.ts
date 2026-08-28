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
  /**
   * Scene parameters chosen when the socket opens.
   *
   * The engine builds its render pipeline for the session, so ambient occlusion
   * and the scale grid are decided here rather than by a command — which is why
   * changing either takes a reconnect, and why their settings say so.
   *
   * Passed in rather than derived, so the connection needs to know nothing about
   * which preferences exist.
   */
  params?: Record<string, string>
}): string {
  const separator = input.baseUrl.includes('?') ? '&' : '?'
  const query = new URLSearchParams(input.params ?? {})

  // Written last, so a contributed parameter cannot overwrite them. A dimension
  // the engine refuses closes the socket with no explanation, and that is not a
  // failure mode to leave reachable from a preference.
  query.set('video_res_width', String(clampDimension(input.width)))
  query.set('video_res_height', String(clampDimension(input.height)))

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

/**
 * A stream size for a panel of this size, with the shape preserved.
 *
 * Clamping each axis on its own is what a first pass does, and it is wrong: a
 * tall narrow panel has its height cut to the maximum and its width left alone,
 * so the engine renders a differently-shaped scene and the viewport shows it
 * letterboxed. Scaling both axes by one ratio keeps the frame the shape of the
 * panel, so the model fills it.
 *
 * The ratio is the smallest that gets both axes to the minimum, capped by the
 * largest that keeps both under the maximum. Rounding to a multiple of four
 * afterwards can still shift the aspect by a fraction of a percent, which is
 * invisible and unavoidable — four is the engine's granularity.
 */
export function streamDimensionsFor(
  width: number,
  height: number
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { width: MIN_STREAM_DIMENSION, height: MIN_STREAM_DIMENSION }
  }

  const toReachMinimum = Math.max(
    MIN_STREAM_DIMENSION / width,
    MIN_STREAM_DIMENSION / height,
    1
  )
  const toStayUnderMaximum = Math.min(
    MAX_STREAM_DIMENSION / width,
    MAX_STREAM_DIMENSION / height
  )
  const ratio = Math.min(toReachMinimum, toStayUnderMaximum)

  return {
    width: clampDimension(width * ratio),
    height: clampDimension(height * ratio),
  }
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
