import type * as LSP from 'vscode-languageserver-protocol'
import Client from './client'
import { LanguageServerPlugin } from './plugin'
import { SemanticToken, deserializeTokens } from './semantic_tokens'

export interface CopilotGetCompletionsParams {
  doc: {
    source: string
    tabSize: number
    indentSize: number
    insertSpaces: boolean
    path: string
    uri: string
    relativePath: string
    languageId: string
    position: {
      line: number
      character: number
    }
  }
}

interface CopilotGetCompletionsResult {
  completions: {
    text: string
    position: {
      line: number
      character: number
    }
    uuid: string
    range: {
      start: {
        line: number
        character: number
      }
      end: {
        line: number
        character: number
      }
    }
    displayText: string
    point: {
      line: number
      character: number
    }
    region: {
      start: {
        line: number
        character: number
      }
      end: {
        line: number
        character: number
      }
    }
  }[]
}

interface CopilotAcceptCompletionParams {
  uuid: string
}

interface CopilotRejectCompletionParams {
  uuids: string[]
}

// https://microsoft.github.io/language-server-protocol/specifications/specification-current/

// Client to server then server to client
interface LSPRequestMap {
  initialize: [LSP.InitializeParams, LSP.InitializeResult]
  'textDocument/hover': [LSP.HoverParams, LSP.Hover]
  'textDocument/completion': [
    LSP.CompletionParams,
    LSP.CompletionItem[] | LSP.CompletionList | null
  ]
  'textDocument/semanticTokens/full': [
    LSP.SemanticTokensParams,
    LSP.SemanticTokens
  ]
  getCompletions: [CopilotGetCompletionsParams, CopilotGetCompletionsResult]
  notifyAccepted: [CopilotAcceptCompletionParams, any]
  notifyRejected: [CopilotRejectCompletionParams, any]
}

// Client to server
interface LSPNotifyMap {
  initialized: LSP.InitializedParams
  'textDocument/didChange': LSP.DidChangeTextDocumentParams
  'textDocument/didOpen': LSP.DidOpenTextDocumentParams
}

// Server to client
interface LSPEventMap {
  'textDocument/publishDiagnostics': LSP.PublishDiagnosticsParams
}

export type Notification = {
  [key in keyof LSPEventMap]: {
    jsonrpc: '2.0'
    id?: null | undefined
    method: key
    params: LSPEventMap[key]
  }
}[keyof LSPEventMap]

export interface LanguageServerClientOptions {
  client: Client
}

export class LanguageServerClient {
  private client: Client

  public ready: boolean

  private plugins: LanguageServerPlugin[]

  public initializePromise: Promise<void>

  private isUpdatingSemanticTokens: boolean = false
  private semanticTokens: SemanticToken[] = []
  private queuedUids: string[] = []

  constructor(options: LanguageServerClientOptions) {
    this.plugins = []
    this.client = options.client

    this.ready = false

    this.queuedUids = []
    this.initializePromise = this.initialize()
  }

  async initialize() {
    // Start the client in the background.
    this.client.start()

    this.ready = true
  }

  getServerCapabilities(): LSP.ServerCapabilities<any> {
    return this.client.getServerCapabilities()
  }

  close() {}

  textDocumentDidOpen(params: LSP.DidOpenTextDocumentParams) {
    this.notify('textDocument/didOpen', params)

    this.updateSemanticTokens(params.textDocument.uri)
  }

  textDocumentDidChange(params: LSP.DidChangeTextDocumentParams) {
    this.notify('textDocument/didChange', params)
    this.updateSemanticTokens(params.textDocument.uri)
  }

  async updateSemanticTokens(uri: string) {
    // Make sure we can only run, if we aren't already running.
    if (!this.isUpdatingSemanticTokens) {
      this.isUpdatingSemanticTokens = true

      const result = await this.request('textDocument/semanticTokens/full', {
        textDocument: {
          uri,
        },
      })

      this.semanticTokens = deserializeTokens(
        result.data,
        this.getServerCapabilities().semanticTokensProvider
      )

      this.isUpdatingSemanticTokens = false
    }
  }

  getSemanticTokens(): SemanticToken[] {
    return this.semanticTokens
  }

  async textDocumentHover(params: LSP.HoverParams) {
    return await this.request('textDocument/hover', params)
  }

  async textDocumentCompletion(params: LSP.CompletionParams) {
    return await this.request('textDocument/completion', params)
  }

  attachPlugin(plugin: LanguageServerPlugin) {
    this.plugins.push(plugin)
  }

  detachPlugin(plugin: LanguageServerPlugin) {
    const i = this.plugins.indexOf(plugin)
    if (i === -1) return
    this.plugins.splice(i, 1)
  }

  private request<K extends keyof LSPRequestMap>(
    method: K,
    params: LSPRequestMap[K][0]
  ): Promise<LSPRequestMap[K][1]> {
    return this.client.request(method, params) as Promise<LSPRequestMap[K][1]>
  }

  private notify<K extends keyof LSPNotifyMap>(
    method: K,
    params: LSPNotifyMap[K]
  ): void {
    return this.client.notify(method, params)
  }

  async getCompletion(params: CopilotGetCompletionsParams) {
    const response = await this.request('getCompletions', params)
    //
    this.queuedUids = [...response.completions.map((c) => c.uuid)]
    return response
  }

  async accept(uuid: string) {
    const badUids = this.queuedUids.filter((u) => u != uuid)
    this.queuedUids = []
    await this.acceptCompletion({ uuid })
    await this.rejectCompletions({ uuids: badUids })
  }

  async reject() {
    const badUids = this.queuedUids
    this.queuedUids = []
    return await this.rejectCompletions({ uuids: badUids })
  }

  async acceptCompletion(params: CopilotAcceptCompletionParams) {
    return await this.request('notifyAccepted', params)
  }
  async rejectCompletions(params: CopilotRejectCompletionParams) {
    return await this.request('notifyRejected', params)
  }

  private processNotification(notification: Notification) {
    for (const plugin of this.plugins) plugin.processNotification(notification)
  }
}
