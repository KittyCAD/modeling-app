import { LspContext, LspWorkerEventType } from './types'
import {
  LanguageClient,
  LanguageClientOptions,
} from 'vscode-languageclient/browser'
import Worker from 'editor/plugins/lsp/worker.ts?worker'

export default class LspServerClient {
  context: LspContext
  client: LanguageClient | null = null
  worker: Worker | null = null

  constructor(context: LspContext) {
    this.context = context
  }

  async startServer() {
    this.worker = new Worker({ name: this.context.worker })
    this.worker.postMessage({
      worker: this.context.worker,
      eventType: LspWorkerEventType.Init,
      eventData: this.context.options,
    })
  }

  async startClient() {
    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ language: 'kcl' }],
      diagnosticCollectionName: 'markers',
    }

    if (!this.worker) {
      console.error('Worker not initialized')
      return
    }

    this.client = new LanguageClient(
      this.context.worker + 'LspClient',
      this.context.worker + ' LSP Client',
      clientOptions,
      this.worker
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
