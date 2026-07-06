import type { LspWorkerEventType } from '@kittycad/codemirror-lsp-client'

export enum LspWorker {
  Kcl = 'kcl',
}
export interface KclWorkerOptions {
  wasmUrl: string
  token: string
  apiBaseUrl: string
}

export interface LspWorkerEvent {
  eventType: LspWorkerEventType
  eventData: Uint8Array | KclWorkerOptions
  worker: LspWorker
}
