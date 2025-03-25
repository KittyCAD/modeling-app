import {
  Codec,
  FromServer,
  IntoServer,
  LspWorkerEventType,
} from '@kittycad/codemirror-lsp-client'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import init, {
  LspServerConfig,
  lsp_run_copilot,
  lsp_run_kcl,
} from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import * as jsrpc from 'json-rpc-2.0'
import {
  LspWorkerEvent,
  LspWorker,
  KclWorkerOptions,
  CopilotWorkerOptions,
} from 'editor/plugins/lsp/types'
import { err, reportRejection } from 'lib/trap'

const intoServer: IntoServer = new IntoServer()
const fromServer: FromServer | Error = FromServer.create()

// Initialise the wasm module.
const initialise = async (wasmUrl: string) => {
  const input = await fetch(wasmUrl)
  const buffer = await input.arrayBuffer()
  return init(buffer)
}

export async function copilotLspRun(
  config: LspServerConfig,
  token: string,
  baseUrl: string
) {
  try {
    console.log('starting copilot lsp')
    await lsp_run_copilot(config, token, baseUrl)
  } catch (e: any) {
    console.log('copilot lsp failed', e)
    // We can't restart here because a moved value, we should do this another way.
  }
}

export async function kclLspRun(
  config: LspServerConfig,
  token: string,
  baseUrl: string
) {
  try {
    console.log('start kcl lsp')
    await lsp_run_kcl(config, token, baseUrl)
  } catch (e: any) {
    console.log('kcl lsp failed', e)
    // We can't restart here because a moved value, we should do this another way.
  }
}

// WebWorker message handler.
onmessage = function (event: MessageEvent) {
  if (err(fromServer)) return
  const { worker, eventType, eventData }: LspWorkerEvent = event.data

  switch (eventType) {
    case LspWorkerEventType.Init:
      let { wasmUrl }: KclWorkerOptions | CopilotWorkerOptions = eventData as
        | KclWorkerOptions
        | CopilotWorkerOptions
      initialise(wasmUrl)
        .then(async (instantiatedModule) => {
          console.log('Worker: WASM module loaded', worker, instantiatedModule)
          const config = new LspServerConfig(
            intoServer,
            fromServer,
            fileSystemManager
          )
          console.log('Starting worker', worker)
          switch (worker) {
            case LspWorker.Kcl:
              const kclData = eventData as KclWorkerOptions
              await kclLspRun(config, kclData.token, kclData.apiBaseUrl)
              break
            case LspWorker.Copilot:
              let copilotData = eventData as CopilotWorkerOptions
              await copilotLspRun(
                config,
                copilotData.token,
                copilotData.apiBaseUrl
              )
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
        fromServer.responses
          .get(json.id)!
          .then((response) => {
            const encoded = Codec.encode(response as jsrpc.JSONRPCResponse)
            postMessage(encoded)
          })
          .catch(reportRejection)
      }
      break
    default:
      console.error('Worker: Unknown message type', worker, eventType)
  }
}
;(async () => {
  if (err(fromServer)) return
  for await (const requests of fromServer.requests) {
    const encoded = Codec.encode(requests as jsrpc.JSONRPCRequest)
    postMessage(encoded)
  }
})().catch(reportRejection)
;(async () => {
  if (err(fromServer)) return
  for await (const notification of fromServer.notifications) {
    const encoded = Codec.encode(notification as jsrpc.JSONRPCRequest)
    postMessage(encoded)
  }
})().catch(reportRejection)
