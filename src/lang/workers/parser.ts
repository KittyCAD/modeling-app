import init, { parse_wasm } from 'wasm-lib/pkg/wasm_lib'
import { Program } from 'lang/wasm'
import { KclError as RustKclError } from 'wasm-lib/kcl/bindings/KclError'
import { KCLError } from 'lang/errors'
import {
  WasmWorkerEventType,
  WasmWorkerEvent,
  WasmWorkerOptions,
  ParserWorkerCall,
  rangeTypeFix,
} from 'lang/workers/types'

// Initialise the wasm module.
const initialise = async (wasmUrl: string) => {
  const input = await fetch(wasmUrl)
  const buffer = await input.arrayBuffer()
  return init(buffer)
}

onmessage = function (event) {
  const { worker, eventType, eventData }: WasmWorkerEvent = event.data

  switch (eventType) {
    case WasmWorkerEventType.Init:
      let { wasmUrl }: WasmWorkerOptions = eventData as WasmWorkerOptions
      initialise(wasmUrl)
        .then((instantiatedModule) => {
          console.log('Worker: WASM module loaded', worker, instantiatedModule)
          postMessage({
            eventType: WasmWorkerEventType.Init,
            response: { worker: worker, initialized: true },
          })
        })
        .catch((error) => {
          console.error('Worker: Error loading wasm module', worker, error)
        })
      break
    case WasmWorkerEventType.Call:
      const data = eventData as ParserWorkerCall
      try {
        const program: Program = parse_wasm(data.code)
        postMessage({ uuid: data.uuid, response: program })
      } catch (e: any) {
        const parsed: RustKclError = JSON.parse(e.toString())
        const kclError = new KCLError(
          parsed.kind,
          parsed.msg,
          rangeTypeFix(parsed.sourceRanges)
        )

        postMessage({
          eventType: WasmWorkerEventType.Call,
          response: { uuid: data.uuid, response: kclError },
        })
      }
      break
    default:
      console.error('Worker: Unknown message type', worker, eventType)
  }
}
