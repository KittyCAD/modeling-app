

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
    code: string
}



export interface WasmWorkerEvent {
  eventType: WasmWorkerEventType
  eventData: Uint8Array | WasmWorkerOptions | ParserWorkerCall
  worker: WasmWorker
}


