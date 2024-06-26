import { UnitLength } from 'wasm-lib/kcl/bindings/UnitLength'

export enum LspWorker {
  Kcl = 'kcl',
  Copilot = 'copilot',
}

interface LspWorkerOptions {
  token: string
  apiBaseUrl: string
  callback: () => void
}

export interface KclWorkerOptions extends LspWorkerOptions {
  baseUnit: UnitLength
}

export interface CopilotWorkerOptions extends LspWorkerOptions {}

export interface LspContext {
  worker: LspWorker
  options: KclWorkerOptions | CopilotWorkerOptions
}
