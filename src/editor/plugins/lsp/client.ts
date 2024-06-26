import { LspContext } from './types'
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node'
import { Wasm, ProcessOptions } from '@vscode/wasm-wasi'
import {
  createStdioOptions,
  createUriConverters,
  startServer,
} from '@vscode/wasm-wasi-lsp'
import * as module from 'wasm-lib/pkg/wasm_lib'

export default class LspServerClient {
  context: LspContext
  client: LanguageClient | null = null
  serverOptions: ServerOptions | null = null

  constructor(context: LspContext) {
    this.context = context
  }

  async startServer() {
    this.serverOptions = async () => {
      const options: ProcessOptions = {
        stdio: createStdioOptions(),
        mountPoints: [{ kind: 'workspaceFolder' }],
      }

      const wasm: Wasm = await Wasm.load()

      const process = await wasm.createProcess(
        'lsp-server',
        module,
        { initial: 160, maximum: 160, shared: true },
        options
      )

      return startServer(process)
    }
  }

  async startClient() {
    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ language: 'kcl' }],
      diagnosticCollectionName: 'markers',
      uriConverters: createUriConverters(),
    }

    if (this.serverOptions === null) {
      return
    }

    this.client = new LanguageClient(
      this.context.worker + 'LspClient',
      this.context.worker + ' LSP Client',
      this.serverOptions,
      clientOptions
    )

    try {
      await this.client.start()
    } catch (error) {
      this.client.error(`Start failed`, error, 'force')
    }
  }

  deactivate() {
    return this.client?.stop()
  }
}
