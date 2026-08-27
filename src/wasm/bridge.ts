/**
 * The JavaScript side of the WASM boundary.
 *
 * `kcl-lib` names two TypeScript modules by path, in
 * `rust/kcl-lib/src/fs/wasm.rs` and
 * `rust/kcl-lib/src/engine/engine_manager/wasm_transport.rs`. Two consequences,
 * both verified against a real `npm run build:wasm`:
 *
 * 1. wasm-bindgen reads those files at compile time, so deleting one is a
 *    `cargo build` failure, not a TypeScript error. It also copies them into the
 *    generated package (`rust/kcl-wasm-lib/pkg/src/wasm/`).
 * 2. The emitted glue does not import the copies. It calls methods on instances
 *    the app hands to WASM — `kcl-wasm-lib`'s `Context` takes an `fs_manager`
 *    argument — so the app's own instances are the ones that run.
 *
 * Providers are still looked up on `globalThis` rather than through a module
 * variable. The copies are real files that something could import, and
 * `EngineCommandManager` is additionally declared with a wasm-bindgen
 * constructor, so Rust may construct it directly. A registry reachable from any
 * copy of the module removes the whole question. It is the one place in this
 * codebase where a global is the right answer.
 */

import type { TypedArray } from '@src/wasm/types'

/** Reads files on behalf of the KCL standard library. */
export interface WasmFileSystemProvider {
  /** Resolve a project-relative path to bytes. */
  readFile(path: string): Promise<TypedArray>
  exists(path: string): Promise<boolean>
  /** Every file under `path`, as project-relative paths. */
  listFiles(path: string): Promise<string[]>
}

/** Carries modeling commands to the engine on behalf of KCL execution. */
export interface WasmEngineTransport {
  /** Fire and forget. Throwing here aborts the execution that issued it. */
  fireModelingCommand(request: ModelingCommandRequest): void
  /** Send and await the engine's msgpack-encoded response. */
  sendModelingCommand(request: ModelingCommandRequest): Promise<TypedArray>
  startNewSession(): Promise<void>
}

export interface ModelingCommandRequest {
  id: string
  /** Where in the source this command came from. */
  sourceRange: unknown
  /** The `WebSocketRequest` the engine expects. */
  command: unknown
  /** Maps command ids to source ranges, for attributing engine errors. */
  idToSourceRange: Record<string, unknown>
}

interface BridgeRegistry {
  fileSystem?: WasmFileSystemProvider
  engine?: WasmEngineTransport
}

const REGISTRY_KEY = '__zdsWasmBridge'

function registry(): BridgeRegistry {
  const host = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: BridgeRegistry
  }
  host[REGISTRY_KEY] ??= {}
  return host[REGISTRY_KEY]
}

/**
 * Install the file system the KCL standard library reads through.
 *
 * Returns a disposer, so a feature can withdraw its provider when it goes away
 * rather than leaving a stale one installed.
 */
export function setWasmFileSystemProvider(
  provider: WasmFileSystemProvider
): () => void {
  registry().fileSystem = provider
  return () => {
    if (registry().fileSystem === provider) {
      registry().fileSystem = undefined
    }
  }
}

/** Install the transport KCL execution sends modeling commands through. */
export function setWasmEngineTransport(
  transport: WasmEngineTransport
): () => void {
  registry().engine = transport
  return () => {
    if (registry().engine === transport) {
      registry().engine = undefined
    }
  }
}

export function getWasmFileSystemProvider():
  | WasmFileSystemProvider
  | undefined {
  return registry().fileSystem
}

export function getWasmEngineTransport(): WasmEngineTransport | undefined {
  return registry().engine
}

/**
 * Errors crossing back into WASM become KCL engine errors, so the message is
 * user-facing. Say what is missing and what it means, not which object is null.
 */
export class BridgeUnavailableError extends Error {
  constructor(what: string) {
    super(
      `${what} is not available. This usually means the app is still starting up, ` +
        'or that no project is open.'
    )
    this.name = 'BridgeUnavailableError'
  }
}
