import {
  ParserWorkerResponse,
  WasmWorker,
  WasmWorkerEventType,
  ParserWorkerCallResponse,
} from 'lang/workers/types'
import Worker from 'lang/workers/parser?worker'
import { Program, wasmUrl } from 'lang/wasm'
import { KCLError } from 'lang/errors'
import { v4 as uuidv4 } from 'uuid'

export default class Parser {
  worker: any = new Worker({ name: 'parse' })
  intitalized: boolean = false
  mappings: Map<string, Program | KCLError> = new Map()

  async parse(code: string): Promise<Program> {
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
    if (!this.intitalized) {
      this.start()
    }
  }

  // Start the worker.
  start() {
    if (this.intitalized) {
      console.log('Worker already initialized')
      return
    }
    this.worker.postMessage({
      worker: WasmWorker.Parser,
      eventType: WasmWorkerEventType.Init,
      eventData: {
        wasmUrl: wasmUrl(),
      },
    })

    this.worker.onmessage = function (r: ParserWorkerResponse) {
      switch (r.eventType) {
        case WasmWorkerEventType.Init:
          this.intitalized = true
          break
        case WasmWorkerEventType.Call:
          const c = r.response as ParserWorkerCallResponse
          this.mappings.set(c.uuid, c.response)
          break
      }
    }
  }
}
