import type { Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'

/** Borrow a context and its operation queue from a scene owner. The owner alone frees native memory after queued operations and independently delivered replies settle. */
export interface NativeContextHost {
  create: () => Promise<Context>
  run: <T>(work: () => Promise<T>) => Promise<T>
  /** Replies can unblock the operation holding `run`; track their lifetime without waiting for that queue. */
  deliverResponse: <T>(work: () => Promise<T>) => Promise<T>
}
