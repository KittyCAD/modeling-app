import { Codec, FromServer, IntoServer } from 'editor/plugins/lsp/codec'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import init, {
  ServerConfig,
  copilot_lsp_run,
  kcl_lsp_run,
} from 'wasm-lib/pkg/wasm_lib'
import * as jsrpc from 'json-rpc-2.0'
import {
  LspWorkerEventType,
  LspWorkerEvent,
  LspWorker,
  KclWorkerOptions,
  CopilotWorkerOptions,
} from 'editor/plugins/lsp/types'
import { EngineCommandManager } from 'lang/std/engineConnection'

const intoServer: IntoServer = new IntoServer()
const fromServer: FromServer = FromServer.create()

// Initialise the wasm module.
const initialise = async (wasmUrl: string) => {
  const input = await fetch(wasmUrl)
  const buffer = await input.arrayBuffer()
  return init(buffer)
}

export async function copilotLspRun(
  config: ServerConfig,
  token: string,
  devMode: boolean = false
) {
  try {
    console.log('starting copilot lsp')
    await copilot_lsp_run(config, token, devMode)
  } catch (e: any) {
    console.log('copilot lsp failed', e)
    // We can't restart here because a moved value, we should do this another way.
  }
}

export async function kclLspRun(
  config: ServerConfig,
  engineCommandManager: EngineCommandManager | null,
  token: string,
  baseUnit: string,
  devMode: boolean = false
) {
  try {
    console.log('start kcl lsp')
    await kcl_lsp_run(config, engineCommandManager, baseUnit, token, devMode)
  } catch (e: any) {
    console.log('kcl lsp failed', e)
    // We can't restart here because a moved value, we should do this another way.
  }
}

onmessage = function (event) {
  const { worker, eventType, eventData }: LspWorkerEvent = event.data

  switch (eventType) {
    case LspWorkerEventType.Init:
      let { wasmUrl }: KclWorkerOptions | CopilotWorkerOptions = eventData as
        | KclWorkerOptions
        | CopilotWorkerOptions
      initialise(wasmUrl)
        .then((instantiatedModule) => {
          console.log('Worker: WASM module loaded', worker, instantiatedModule)
          const config = new ServerConfig(
            intoServer,
            fromServer,
            fileSystemManager
          )
          console.log('Starting worker', worker)
          switch (worker) {
            case LspWorker.Kcl:
              const kclData = eventData as KclWorkerOptions
              kclLspRun(
                config,
                null,
                kclData.token,
                kclData.baseUnit,
                kclData.devMode
              )
              break
            case LspWorker.Copilot:
              let copilotData = eventData as CopilotWorkerOptions
              copilotLspRun(config, copilotData.token, copilotData.devMode)
              break
          }
        })
        .catch((error) => {
          console.error('Worker: Error loading wasm module', worker, error)
        })
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

new Promise<void>(async (resolve) => {
  for await (const notification of fromServer.notifications) {
    const encoded = Codec.encode(notification as jsrpc.JSONRPCRequest)
    postMessage(encoded)
  }
})
