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
  WriteableStreamMessageWriter,
  ReadableStreamMessageReader,
  Message,
} from 'vscode-languageclient'
import { LspWorkerEvent, LspWorkerEventType } from 'editor/plugins/lsp/types'
import { WritableStreamImpl } from 'editor/plugins/lsp/writer'
import Queue from 'editor/plugins/lsp/queue'
import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from 'vscode-languageserver-protocol/browser'
import * as jsrpc from 'json-rpc-2.0'

class Headers {
  static add(message: string): string {
    return `Content-Length: ${message.length}\r\n\r\n${message}`
  }

  static remove(delimited: string): string {
    return delimited.replace(/^Content-Length:\s*\d+\s*/, '')
  }
}

export const encoder = new TextEncoder()
export const decoder = new TextDecoder()

class Codec {
  static encode(message: Message): Uint8Array {
    const rpc = JSON.stringify(message.jsonrpc)
    const delimited = Headers.add(rpc)
    return encoder.encode(delimited)
  }

  static decode<T>(data: Uint8Array): T {
    const delimited = decoder.decode(data)
    const message = Headers.remove(delimited)
    return JSON.parse(message) as T
  }
}

class IntoServer extends Queue<Uint8Array> {
  constructor(reader: BrowserMessageReader) {
    super()
    reader.listen((message: Message) => {
      super.enqueue(Codec.encode(message))
    })
  }
}

class FromServer extends Queue<Uint8Array> {
  constructor(writer: BrowserMessageWriter) {
    super(
      new WritableStream({
        write(item: Uint8Array): void {
          writer.write(Codec.decode(item))
        },
      })
    )
  }
}

const browserReader = new BrowserMessageReader(self)
const browserWriter = new BrowserMessageWriter(self)

const intoServer = new IntoServer(browserReader)
const fromServer = new FromServer(browserWriter)

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
  if (err(intoServer)) return
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
