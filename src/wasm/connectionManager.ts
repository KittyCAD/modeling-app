/**
 * `EngineCommandManager`, imported by `kcl-lib` at
 * `rust/kcl-lib/src/engine/engine_manager/wasm_transport.rs`.
 *
 * KCL execution sends modeling commands to the engine through this class. Rust
 * constructs it itself with a zero-argument constructor, and the method shapes
 * are dictated by that side:
 *
 * - all four string arguments arrive as JSON and are parsed here
 * - `fireModelingCommandFromWasm` is fire-and-forget; throwing aborts the
 *   execution that issued the command
 * - `sendModelingCommandFromWasm` must resolve to the engine's msgpack bytes as
 *   a `Uint8Array`
 * - `startNewSession` must resolve once the engine is ready for a new scene
 *
 * Runtime-self-contained and types-only in its imports, for the reasons in
 * `src/wasm/fileSystemManager.ts`.
 */

import type {
  ModelingCommandRequest,
  WasmEngineTransport,
} from '@src/wasm/bridge'

function transport(): WasmEngineTransport {
  const host = globalThis as typeof globalThis & {
    __zdsWasmBridge?: { engine?: WasmEngineTransport }
  }
  const found = host.__zdsWasmBridge?.engine
  if (!found) {
    // Reaches the user as a KCL engine error, so it describes the situation
    // rather than the missing object.
    throw new Error(
      'Not connected to the modeling engine, so this model cannot be built yet.'
    )
  }
  return found
}

function toRequest(
  id: string,
  rangeStr: string,
  commandStr: string,
  idToRangeStr: string
): ModelingCommandRequest {
  return {
    id,
    sourceRange: JSON.parse(rangeStr),
    command: JSON.parse(commandStr),
    idToSourceRange: JSON.parse(idToRangeStr),
  }
}

export class EngineCommandManager {
  /**
   * Called from WASM. Fire and forget.
   *
   * Rust treats a throw as a command failure and stops the execution, which is
   * what should happen when there is nothing to send to.
   */
  fireModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): void {
    transport().fireModelingCommand(
      toRequest(id, rangeStr, commandStr, idToRangeStr)
    )
  }

  /** Called from WASM. Resolves to the engine's msgpack response bytes. */
  async sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string,
    idToRangeStr: string
  ): Promise<Uint8Array> {
    return transport().sendModelingCommand(
      toRequest(id, rangeStr, commandStr, idToRangeStr)
    )
  }

  /** Called from WASM before a fresh execution. */
  async startNewSession(): Promise<void> {
    return transport().startNewSession()
  }
}

/**
 * Kept for parity with the file system manager: the WASM side builds its own,
 * and this gives app code and tests a handle on the same path.
 */
export const engineCommandManager = new EngineCommandManager()
