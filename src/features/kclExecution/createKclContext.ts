import type { EngineConnection } from '@src/contracts/engine'
import {
  type KclWasmModule,
  loadKclWasm,
} from '@src/features/kclAnalysis/wasmModule'
import { EngineCommandManager } from '@src/wasm/connectionManager'
import { FileSystemManager } from '@src/wasm/fileSystemManager'

/** The subset of the WASM `Context` this app calls. */
export interface KclContext {
  execute(
    programAstJson: string,
    path: string | null | undefined,
    settings: string
  ): Promise<unknown>
  sendResponse(data: Uint8Array): Promise<void>
  bustCacheAndResetScene(
    settings: string,
    path?: string | null
  ): Promise<unknown>
}

export interface KclContextHandle {
  context: KclContext
  wasm: KclWasmModule
  /**
   * `kcl-lib`'s own defaults, parsed.
   *
   * Kept as the base for each execution's settings rather than serialised once:
   * a preference can change between two runs, and fields this app has no setting
   * for should keep whatever the library considers correct.
   */
  defaultSettings: unknown
  dispose: () => void
}

/**
 * Owns the WASM execution context for one engine session.
 *
 * The context holds engine-side state — a scene, a command cache — so its
 * lifetime is the *connection's*, not the app's. Reusing one across a reconnect
 * would leave it referring to a scene that no longer exists, which surfaces
 * later as commands failing for no visible reason.
 *
 * Created lazily and torn down when the connection drops, so nothing loads the
 * WASM bundle or opens a scene until something actually executes.
 */
export function createKclContextOwner(engine: EngineConnection) {
  let handle: KclContextHandle | null = null
  let loading: Promise<KclContextHandle> | null = null
  let releaseResponses: (() => void) | null = null

  const build = async (): Promise<KclContextHandle> => {
    const wasm = await loadKclWasm()

    // The app's own FFI classes: the same ones `kcl-lib` declares, and the
    // instances it will call into. The engine transport is already registered,
    // so these reach the live connection.
    const engineManager = new EngineCommandManager()
    const fileSystemManager = new FileSystemManager()

    const context = new wasm.Context(
      engineManager,
      fileSystemManager,
      undefined
    ) as unknown as KclContext

    /**
     * Feed the engine's unsolicited replies back into KCL's runtime.
     *
     * Fired commands are answered too, and `kcl-lib` is tracking what it fired.
     * Without this the runtime waits for state it never receives, and execution
     * hangs rather than failing.
     */
    releaseResponses = engine.onUnmatchedResponse((bytes) => {
      void context.sendResponse(bytes).catch((error) => {
        console.warn('kclExecution: engine response was rejected', error)
      })
    })

    return {
      context,
      wasm,
      defaultSettings: wasm.default_app_settings(),
      dispose: () => {
        releaseResponses?.()
        releaseResponses = null
        /**
         * Deliberately not calling `free()`.
         *
         * The context may still be borrowed by an execution that has not
         * unwound, and wasm-bindgen throws "attempted to take ownership of Rust
         * value while it was borrowed" — which then surfaces as a bogus KCL
         * error. Dropping the reference lets wasm-bindgen's finalization
         * registry reclaim it once nothing holds it.
         */
      },
    }
  }

  return {
    /** The context for the current session, building it if needed. */
    async get(): Promise<KclContextHandle> {
      if (handle) return handle
      // Shared promise, so two executions racing to start do not build two
      // contexts and two scenes.
      loading ??= build().then((built) => {
        handle = built
        loading = null
        return built
      })
      return loading
    },

    /** Drop the context. Called when the engine session ends. */
    reset() {
      handle?.dispose()
      handle = null
      loading = null
    },
  }
}
