import type { LspWorkerEventType } from '@kittycad/codemirror-lsp-client'
import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'

export enum LspWorker {
  Kcl = 'kcl',
}
export interface KclWorkerOptions {
  wasmUrl: string
  token: string
  apiBaseUrl: string
  /**
   * Installed into the worker's own wasm instance before the LSP server
   * starts; the main thread's flags never reach this instance otherwise.
   */
  kclRuntimeFlags: KclRuntimeFlags
}

export type LspWorkerEvent =
  | {
      eventType: LspWorkerEventType.Init
      eventData: KclWorkerOptions
      worker: LspWorker
    }
  | {
      eventType: LspWorkerEventType.Call
      eventData: Uint8Array
      worker: LspWorker
    }
