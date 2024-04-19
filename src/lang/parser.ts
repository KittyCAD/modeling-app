import {
  ParserWorkerResponse,
  WasmWorker,
  WasmWorkerEventType,
} from 'lang/workers/types'
import ParserWorker from 'lang/workers/parser?worker'
import { wasmUrl } from 'lang/wasm'
import { KCLError } from 'lang/errors'
import { v4 as uuidv4 } from 'uuid'
export type { Program } from 'wasm-lib/kcl/bindings/Program'

export default class Parser {
  worker: ParserWorker | null = null
  mappings: Map<string, Program | KCLError> = new Map()

  async parse(code: string): Program {
    this.ensureWorker()
    const uuid = uuidv4()
    this.worker.postMessage({
      worker: WasmWorker.Parser,
      eventType: WasmWorkerEventType.Call,
      eventData: {
        uuid,
        code,
      },
    })
    let result = await this.waitForResult(uuid)
    if (result instanceof KCLError) {
      throw result
    }
    return result
  }

  waitForResult(uuid: string): Promise<Program | KCLError> {
    return new Promise((resolve) => {
      const result = this.mappings.get(uuid)
      if (result) {
        this.mappings.delete(uuid)
        resolve(result)
      } else {
        setTimeout(() => {
          resolve(this.waitForResult(uuid))
        }, 100)
      }
    })
  }

  ensureWorker() {
    if (!this.worker) {
      this.start()
    }
  }

  // Start the worker.
  start() {
    this.worker = new ParserWorker({ name: 'parse' })
    this.worker.postMessage({
      worker: WasmWorker.Parser,
      eventType: WasmWorkerEventType.Init,
      eventData: {
        wasmUrl: wasmUrl(),
      },
    })

    this.worker.onmessage = function (e) {
      const { uuid, response } = e.data as ParserWorkerResponse
      this.mappings.set(uuid, response)
    }
  }
}
