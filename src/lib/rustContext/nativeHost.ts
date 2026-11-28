import type { Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'

/**
 * Let the legacy RustContext wrapper use a WASM Context owned by a KCL runtime.
 * The modeling-machine migration keeps RustContext's existing sketch operations,
 * while createKclRuntime owns the context used to execute and export the model.
 * Supplying this host makes those operations use the same native state and queue.
 * Otherwise RustContext would allocate a separate context for its sketch work.
 *
 * The runtime remains responsible for freeing the context. On disposal it waits
 * for queued operations and replies already being delivered. RustContext must
 * leave that memory allocated when it is destroyed.
 *
 * This interface adapts the legacy wrapper; future tool contributions can call
 * explicit runtime operations instead of going through RustContext. Once those
 * callers are migrated, the borrowing interface can be removed. The runtime must
 * still serialize operations, deliver replies that unblock them, and wait for
 * both to finish before freeing native memory.
 */
export interface NativeContextHost {
  /** Return the runtime's existing context; this does not allocate another one. */
  create: () => Promise<Context>
  /** Queue an operation alongside the runtime's execution and exports. */
  run: <T>(work: () => Promise<T>) => Promise<T>
  /**
   * Deliver a reply outside the operation queue: the running operation may be
   * waiting for it. Replies remain allowed during closing until memory is freed.
   */
  deliverResponse: <T>(work: () => Promise<T>) => Promise<T>
}
