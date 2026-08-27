/**
 * `FileSystemManager`, imported by `kcl-lib` at `rust/kcl-lib/src/fs/wasm.rs`.
 *
 * The KCL standard library reads imported files through this class while
 * executing. Every method here is called from Rust, so the shapes are dictated
 * by that side and are not free to change:
 *
 * - `readFile`    must resolve to a `Uint8Array` (Rust wraps it directly)
 * - `exists`      must resolve to a boolean
 * - `getAllFiles` must resolve to a JSON **string** of an array of paths, which
 *                 Rust then parses. Resolving an actual array fails there.
 *
 * Runtime-self-contained on purpose: it imports only types, which are erased,
 * because wasm-bindgen copies this file into the generated package where this
 * project's import aliases may not apply. The provider it delegates to is
 * looked up on `globalThis` for the same reason — see `src/wasm/bridge.ts`.
 */

import type { WasmFileSystemProvider } from '@src/wasm/bridge'

function provider(): WasmFileSystemProvider {
  const host = globalThis as typeof globalThis & {
    __zdsWasmBridge?: { fileSystem?: WasmFileSystemProvider }
  }
  const found = host.__zdsWasmBridge?.fileSystem
  if (!found) {
    // Surfaces in KCL as an engine error, so it is written for a user who is
    // wondering why an import did not resolve.
    throw new Error(
      'No file system is available to read imported files. This usually means no project is open.'
    )
  }
  return found
}

export class FileSystemManager {
  /** Called from WASM. Resolves to the file's bytes. */
  async readFile(path: string): Promise<Uint8Array> {
    return provider().readFile(path)
  }

  /** Called from WASM. */
  async exists(path: string): Promise<boolean> {
    return provider().exists(path)
  }

  /**
   * Called from WASM.
   *
   * Returns a JSON string rather than an array because the Rust side reads the
   * value with `as_string()` and parses it with serde.
   */
  async getAllFiles(path: string): Promise<string> {
    return JSON.stringify(await provider().listFiles(path))
  }
}

/**
 * A shared instance, for callers that want the same manager the WASM side uses.
 *
 * The WASM side constructs its own; this exists so app code has something to
 * exercise the same path in tests and at a console.
 */
export const fileSystemManager = new FileSystemManager()
