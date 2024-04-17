import { UnitLength } from 'wasm-lib/kcl/bindings/UnitLength'

export enum LspWorker {
  Kcl = 'kcl',
  Copilot = 'copilot',
}
export interface KclWorkerOptions {
  token: string
  baseUnit: UnitLength
}

export interface CopilotWorkerOptions {
  token: string
}

export enum LspWorkerEventType {
  Init = 'init',
  Call = 'call',
}

export interface LspWorkerEvent {
  eventType: LspWorkerEventType
  eventData: Uint8Array | KclWorkerOptions | CopilotWorkerOptions
  worker: LspWorker
}
