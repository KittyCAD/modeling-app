import { fileSystemManager } from 'lang/std/fileSystemManager'
import init, {parse_wasm
} from 'wasm-lib/pkg/wasm_lib'
import * as jsrpc from 'json-rpc-2.0'
import { Program } from 'lang/wasm'
import { KclError as RustKclError } from 'wasm-lib/kcl/bindings/KclError'
import { KCLError } from 'lang/errors'
import { WasmWorkerEventType, WasmWorkerEvent, WasmWorkerOptions } from './types'

// Initialise the wasm module.
const initialise = async (wasmUrl: string) => {
  const input = await fetch(wasmUrl)
  const buffer = await input.arrayBuffer()
  return init(buffer)
}

export const rangeTypeFix = (ranges: number[][]): [number, number][] =>
  ranges.map(([start, end]) => [start, end])

export const parse = (code: string): Program => {
  try {
    const program: Program = parse_wasm(code)
    return program
  } catch (e: any) {
    const parsed: RustKclError = JSON.parse(e.toString())
    const kclError = new KCLError(
      parsed.kind,
      parsed.msg,
      rangeTypeFix(parsed.sourceRanges)
    )

    console.log(kclError)
    throw kclError
  }
}
onmessage = function (event) {
  const { worker, eventType, eventData }: WasmWorkerEvent = event.data

  switch (eventType) {
    case WasmWorkerEventType.Init:
      let { wasmUrl }: WasmWorkerOptions = eventData as WasmWorkerOptions
      initialise(wasmUrl)
        .then((instantiatedModule) => {
          console.log('Worker: WASM module loaded', worker, instantiatedModule)
        })
        .catch((error) => {
          console.error('Worker: Error loading wasm module', worker, error)
        })
      break
    case WasmWorkerEventType.Call:
      const data = eventData as Uint8Array
      intoServer.enqueue(data)
      const json: jsrpc.JSONRPCRequest = Codec.decode(data)
      if (null != json.id) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        fromServer.responses.get(json.id)!.then((response) => {
          const encoded = Codec.encode(response as jsrpc.JSONRPCResponse)
          postMessage(encoded)
        })
      }
      break
    default:
      console.error('Worker: Unknown message type', worker, eventType)
  }
}

