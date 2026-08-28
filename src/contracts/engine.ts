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

/**
 * One modelling command, without the envelope.
 *
 * The websocket framing, the command id, and the source-range bookkeeping are
 * the connection's business; a feature that wants the camera moved should say so
 * and nothing else.
 */
export type SceneCommand = { type: string } & Record<string, unknown>

export interface EngineConnection {
  readonly state: ReadonlySignal<EngineConnectionState>
  /**
   * Increments whenever the engine begins a fresh scene.
   *
   * A new connection and a restarted session both leave the engine at its own
   * defaults, so everything the app had told it — the background colour, whether
   * edges are drawn, which way the camera projects — has to be restated. Without
   * a signal for it, each of those would need to know about the others' triggers;
   * with one, each keeps a single effect keyed on this.
   */
  readonly sceneEpoch: ReadonlySignal<number>
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
   * Reported rather than passed at connect time, because the engine allocates
   * its render target when the connection is made and the size therefore has to
   * be known *before* whoever clicks connect gets involved.
   *
   * A resize while connected reconfigures the live stream, so toggling a pane or
   * resizing the window does not need a reconnect. Bursts are coalesced and a
   * collapsed pane is ignored; see the implementation for why.
   */
  reportViewportSize(size: { width: number; height: number }): void
  /**
   * The size the stream is, or will be.
   *
   * Shaped like the panel rather than clamped per axis, so the frame the engine
   * renders is the shape of the space it is shown in.
   */
  readonly viewportSize: ReadonlySignal<{ width: number; height: number }>

  /** Fire and forget. Throws if there is nothing to send over. */
  fire(request: ModelingCommandRequest): void
  /** Send and resolve with the engine's msgpack response bytes. */
  send(request: ModelingCommandRequest): Promise<Uint8Array>
  /**
   * Fire one modelling command, envelope and id supplied.
   *
   * Silently does nothing while there is no connection. Scene commands describe
   * a scene that does not exist yet, so failing to send one is not an error
   * worth propagating to whoever changed a setting.
   */
  fireCommand(cmd: SceneCommand): void
  /** Send one modelling command and await the engine's response bytes. */
  sendCommand(cmd: SceneCommand): Promise<Uint8Array>
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
