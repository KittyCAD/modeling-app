import { UnitLength } from 'wasm-lib/kcl/bindings/UnitLength'

export enum LspWorker {
  Kcl = 'kcl',
  Copilot = 'copilot',
}

interface LspWorkerOptions {
  token: string
  apiBaseUrl: string
  callback: () => void
  wasmUrl: string
}

export interface KclWorkerOptions extends LspWorkerOptions {
  baseUnit: UnitLength
}

export interface CopilotWorkerOptions extends LspWorkerOptions {}

export interface LspContext {
  worker: LspWorker
  options: KclWorkerOptions | CopilotWorkerOptions
}

export enum LspWorkerEventType {
  Init = 'init',
}

export interface LspWorkerEvent {
  eventType: LspWorkerEventType
  eventData: Uint8Array | KclWorkerOptions | CopilotWorkerOptions
  worker: LspWorker
}
