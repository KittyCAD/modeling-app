import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ModelingCommandRequest } from '@src/wasm/bridge'

export type EngineConnectionStatus =
  | 'offline'
  | 'connecting'
  | 'connected'
  | 'failed'

/**
 * Which step of connecting we are on.
 *
 * Reported because "connecting" on its own is useless when it stalls: knowing
 * whether it stopped at the websocket, at authentication, or at ICE is the
 * difference between a five-minute diagnosis and an hour of guessing.
 */
export type EngineConnectionStage =
  | 'websocket'
  | 'authenticating'
  | 'negotiating'
  | 'streaming'

export interface EngineConnectionState {
  status: EngineConnectionStatus
  stage: EngineConnectionStage | null
  error: string | null
  /** Round-trip latency in milliseconds, from the ping/pong pair. */
  pingMs: number | null
  /** The engine's id for this session. Worth quoting in a bug report. */
  apiCallId: string | null
}

export interface EngineConnection {
  readonly state: ReadonlySignal<EngineConnectionState>
  /**
   * The engine's video track, once negotiated.
   *
   * The scene is rendered server-side and streamed, so this is the viewport's
   * actual content rather than something drawn locally.
   */
  readonly mediaStream: ReadonlySignal<MediaStream | null>

  connect(options?: { width: number; height: number }): Promise<void>
  disconnect(): void

  /**
   * Tell the connection how big the viewport is.
   *
   * The engine allocates its render target when the connection is made, so the
   * size has to be known *before* connecting — which is why this is reported
   * rather than passed at connect time by whoever happens to click the button.
   * A resize after connecting needs a reconnect to take effect.
   */
  reportViewportSize(size: { width: number; height: number }): void
  /** The size the next connection will request. */
  readonly viewportSize: ReadonlySignal<{ width: number; height: number }>

  /** Fire and forget. Throws if there is nothing to send over. */
  fire(request: ModelingCommandRequest): void
  /** Send and resolve with the engine's msgpack response bytes. */
  send(request: ModelingCommandRequest): Promise<Uint8Array>
  /** Tell the engine to start a fresh scene. */
  startNewSession(): Promise<void>

  /**
   * Responses that match no pending request.
   *
   * Fired commands still produce responses, and KCL's own runtime needs them —
   * it tracks what it fired. Without this the engine's replies to fired commands
   * would be dropped and execution would hang waiting for state it never sees.
   */
  onUnmatchedResponse(listener: (bytes: Uint8Array) => void): () => void
}

export const engineContract = defineContract({
  engineConnectionService: defineService<EngineConnection>('engine.connection'),
})

export const { engineConnectionService } = engineContract
