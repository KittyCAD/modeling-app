import type { LspWorkerEventType } from '@kittycad/codemirror-lsp-client'

export enum LspWorker {
  Kcl = 'kcl',
}
export interface KclWorkerOptions {
  wasmUrl: string
  token: string
  apiBaseUrl: string
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
