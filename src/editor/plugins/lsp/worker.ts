import { Codec, FromServer, IntoServer } from 'editor/plugins/lsp/codec'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { ServerConfig } from 'wasm-lib/pkg/wasm_lib'
import * as jsrpc from 'json-rpc-2.0'
import { copilotLspRun, initPromise, kclLspRun } from 'lang/wasm'
import {
  LspWorkerEventType,
  LspWorkerEvent,
  LspWorker,
  KclWorkerOptions,
  CopilotWorkerOptions,
} from 'editor/plugins/lsp/types'

const intoServer: IntoServer = new IntoServer()
const fromServer: FromServer = FromServer.create()

onmessage = function (event) {
  const { worker, eventType, eventData }: LspWorkerEvent = event.data

  switch (eventType) {
    case LspWorkerEventType.Init:
      initPromise
        .then((instantiatedModule) => {
          const config = new ServerConfig(
            intoServer,
            fromServer,
            fileSystemManager
          )
          console.log('Starting worker', worker)
          switch (worker) {
            case LspWorker.Kcl:
              const kclData = eventData as KclWorkerOptions
              kclLspRun(config, null, kclData.token, kclData.baseUnit)
              break
            case LspWorker.Copilot:
              let copilotData = eventData as CopilotWorkerOptions
              copilotLspRun(config, copilotData.token)
              break
          }
        })
        .catch((error) => {
          console.error('Worker: Error loading wasm module', worker, error)
        })
      // Initialize the wasm module.
      // Even though we start on millimeters we upate the units later on.
      break
    case LspWorkerEventType.Call:
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

new Promise<void>(async (resolve) => {
  for await (const requests of fromServer.requests) {
    const encoded = Codec.encode(requests as jsrpc.JSONRPCRequest)
    postMessage(encoded)
  }
})

for await (const notification of fromServer.notifications) {
  const encoded = Codec.encode(notification as jsrpc.JSONRPCRequest)
  postMessage(encoded)
}
