import {
  Codec,
  FromServer,
  IntoServer,
  LspWorkerEventType,
} from '@kittycad/codemirror-lsp-client'
import type * as jsrpc from 'json-rpc-2.0'

import init, {
  LspServerConfig,
  lsp_run_kcl,
} from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'

import type { LspWorkerEvent } from '@src/editor/plugins/lsp/types'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import { err, reportRejection } from '@src/lib/trap'

const intoServer: IntoServer = new IntoServer()
const fromServer: FromServer | Error = FromServer.create()

// Initialise the wasm module.
const initialise = async (wasmUrl: string) => {
  const input = await fetch(wasmUrl)
  const buffer = await input.arrayBuffer()
  return init(buffer)
}

export async function kclLspRun(
  config: LspServerConfig,
  token: string,
  baseUrl: string
) {
  try {
    console.log('start kcl lsp')
    await lsp_run_kcl(config, token, baseUrl)
  } catch (e: unknown) {
    console.log('kcl lsp failed', e)
    // We can't restart here because a moved value, we should do this another way.
  }
}

// WebWorker message handler.
onmessage = (event: MessageEvent) => {
  if (err(fromServer)) {
    return
  }
  const lspEvent: LspWorkerEvent = event.data
  const { worker } = lspEvent

  switch (lspEvent.eventType) {
    case LspWorkerEventType.Init: {
      const { wasmUrl, token, apiBaseUrl } = lspEvent.eventData
      initialise(wasmUrl)
        .then(async (instantiatedModule) => {
          console.log('Worker: WASM module loaded', worker, instantiatedModule)
          const config = new LspServerConfig(
            intoServer,
            fromServer,
            projectFsManager
          )
          console.log('Starting worker', worker)
          await kclLspRun(config, token, apiBaseUrl)
        })
        .catch((error) => {
          console.error('Worker: Error loading wasm module', worker, error)
        })
      break
    }
    case LspWorkerEventType.Call: {
      const data = lspEvent.eventData
      intoServer.enqueue(data)
      const json: jsrpc.JSONRPCRequest = Codec.decode(data)
      if (null != json.id) {
        const response = fromServer.responses.get(json.id)
        if (response) {
          response
            .then((response) => {
              const encoded = Codec.encode(response as jsrpc.JSONRPCResponse)
              postMessage(encoded)
            })
            .catch(reportRejection)
        }
      }
      break
    }
    default:
      console.error(
        'Worker: Unknown message type',
        worker,
        (event.data as { eventType?: unknown }).eventType
      )
  }
}
;(async () => {
  if (err(fromServer)) {
    return
  }
  for await (const requests of fromServer.requests) {
    const encoded = Codec.encode(requests as jsrpc.JSONRPCRequest)
    postMessage(encoded)
  }
})().catch(reportRejection)
;(async () => {
  if (err(fromServer)) {
    return
  }
  for await (const notification of fromServer.notifications) {
    const encoded = Codec.encode(notification as jsrpc.JSONRPCRequest)
    postMessage(encoded)
  }
})().catch(reportRejection)
