import { KCLError } from 'lang/errors'
import { Program } from 'lang/wasm'

export enum WasmWorker {
  Parser = 'parser',
}
export enum WasmWorkerEventType {
  Init = 'init',
  Call = 'call',
}

export interface WasmWorkerOptions {
  wasmUrl: string
}

export interface ParserWorkerCall {
  uuid: string
  code: string
}

export interface ParserWorkerResponse {
  uuid: string
  response: Program | KCLError
}

export interface WasmWorkerEvent {
  eventType: WasmWorkerEventType
  eventData: Uint8Array | WasmWorkerOptions | ParserWorkerCall
  worker: WasmWorker
}

export const rangeTypeFix = (ranges: number[][]): [number, number][] =>
  ranges.map(([start, end]) => [start, end])
