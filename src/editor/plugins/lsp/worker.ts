import { fileSystemManager } from 'lang/std/fileSystemManager'
import init, {
  ServerConfig,
  copilot_lsp_run,
  kcl_lsp_run,
} from 'wasm-lib/pkg/wasm_lib'
import {
  LspWorker,
  KclWorkerOptions,
  CopilotWorkerOptions,
} from 'editor/plugins/lsp/types'
import { EngineCommandManager } from 'lang/std/engineConnection'
import { err } from 'lib/trap'
import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from 'vscode-languageserver/browser'
import { LspWorkerEvent, LspWorkerEventType } from 'editor/plugins/lsp/types'

const messageReader = new BrowserMessageReader(self)
const messageWriter = new BrowserMessageWriter(self)

// Initialise the wasm module.
const initialise = async (wasmUrl: string) => {
  const input = await fetch(wasmUrl)
  const buffer = await input.arrayBuffer()
  return init(buffer)
}

export async function copilotLspRun(
  config: ServerConfig,
  token: string,
  baseUrl: string
) {
  try {
    console.log('starting copilot lsp')
    await copilot_lsp_run(config, token, baseUrl)
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
  baseUrl: string
) {
  try {
    console.log('start kcl lsp')
    await kcl_lsp_run(config, engineCommandManager, baseUnit, token, baseUrl)
  } catch (e: any) {
    console.log('kcl lsp failed', e)
    // We can't restart here because a moved value, we should do this another way.
  }
}

onmessage = function (event) {
  if (err(messageReader)) return
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
            messageWriter,
            messageReader,
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
                kclData.apiBaseUrl
              )
              break
            case LspWorker.Copilot:
              let copilotData = eventData as CopilotWorkerOptions
              copilotLspRun(config, copilotData.token, copilotData.apiBaseUrl)
              break
          }
        })
        .catch((error) => {
          console.error('Worker: Error loading wasm module', worker, error)
        })
      break
    default:
      console.error('Worker: Unknown message type', worker, eventType)
  }
}
