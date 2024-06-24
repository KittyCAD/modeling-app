import type * as LSP from 'vscode-languageserver-protocol'
import Client from './client'
import { SemanticToken, deserializeTokens } from './kcl/semantic_tokens'
import { LanguageServerPlugin } from 'editor/plugins/lsp/plugin'
import { CopilotLspCompletionParams } from 'wasm-lib/kcl/bindings/CopilotLspCompletionParams'
import { CopilotCompletionResponse } from 'wasm-lib/kcl/bindings/CopilotCompletionResponse'
import { CopilotAcceptCompletionParams } from 'wasm-lib/kcl/bindings/CopilotAcceptCompletionParams'
import { CopilotRejectCompletionParams } from 'wasm-lib/kcl/bindings/CopilotRejectCompletionParams'
import { UpdateUnitsParams } from 'wasm-lib/kcl/bindings/UpdateUnitsParams'
import { UpdateCanExecuteParams } from 'wasm-lib/kcl/bindings/UpdateCanExecuteParams'
import { UpdateUnitsResponse } from 'wasm-lib/kcl/bindings/UpdateUnitsResponse'
import { UpdateCanExecuteResponse } from 'wasm-lib/kcl/bindings/UpdateCanExecuteResponse'
import { LspWorker } from './types'

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
  'textDocument/formatting': [
    LSP.DocumentFormattingParams,
    LSP.TextEdit[] | null
  ]
  'textDocument/foldingRange': [LSP.FoldingRangeParams, LSP.FoldingRange[]]
  'copilot/getCompletions': [
    CopilotLspCompletionParams,
    CopilotCompletionResponse
  ]
  'kcl/updateUnits': [UpdateUnitsParams, UpdateUnitsResponse | null]
  'kcl/updateCanExecute': [UpdateCanExecuteParams, UpdateCanExecuteResponse]
}

// Client to server
interface LSPNotifyMap {
  initialized: LSP.InitializedParams
  'textDocument/didChange': LSP.DidChangeTextDocumentParams
  'textDocument/didOpen': LSP.DidOpenTextDocumentParams
  'textDocument/didClose': LSP.DidCloseTextDocumentParams
  'workspace/didChangeWorkspaceFolders': LSP.DidChangeWorkspaceFoldersParams
  'workspace/didCreateFiles': LSP.CreateFilesParams
  'workspace/didRenameFiles': LSP.RenameFilesParams
  'workspace/didDeleteFiles': LSP.DeleteFilesParams
  'copilot/notifyAccepted': CopilotAcceptCompletionParams
  'copilot/notifyRejected': CopilotRejectCompletionParams
}

export interface LanguageServerClientOptions {
  client: Client
  name: LspWorker
}

export interface LanguageServerOptions {
  // We assume this is the main project directory, we are currently working in.
  workspaceFolders: LSP.WorkspaceFolder[]
  documentUri: string
  allowHTMLContent: boolean
  client: LanguageServerClient
}

export class LanguageServerClient {
  private client: Client
  readonly name: string

  public ready: boolean

  readonly plugins: LanguageServerPlugin[]

  public initializePromise: Promise<void>

  private isUpdatingSemanticTokens: boolean = false
  private semanticTokens: SemanticToken[] = []
  private queuedUids: string[] = []

  constructor(options: LanguageServerClientOptions) {
    this.plugins = []
    this.client = options.client
    this.name = options.name

    this.ready = false

    this.queuedUids = []
    this.initializePromise = this.initialize()
  }

  async initialize() {
    // Start the client in the background.
    this.client.setNotifyFn(this.processNotifications.bind(this))
    this.client.start()

    this.ready = true
  }

  getName(): string {
    return this.name
  }

  getServerCapabilities(): LSP.ServerCapabilities<any> {
    return this.client.getServerCapabilities()
  }

  close() {}

  textDocumentDidOpen(params: LSP.DidOpenTextDocumentParams) {
    this.notify('textDocument/didOpen', params)

    // Update the facet of the plugins to the correct value.
    for (const plugin of this.plugins) {
      plugin.documentUri = params.textDocument.uri
      plugin.languageId = params.textDocument.languageId
    }

    this.updateSemanticTokens(params.textDocument.uri)
  }

  textDocumentDidChange(params: LSP.DidChangeTextDocumentParams) {
    this.notify('textDocument/didChange', params)
    this.updateSemanticTokens(params.textDocument.uri)
  }

  textDocumentDidClose(params: LSP.DidCloseTextDocumentParams) {
    this.notify('textDocument/didClose', params)
  }

  workspaceDidChangeWorkspaceFolders(
    added: LSP.WorkspaceFolder[],
    removed: LSP.WorkspaceFolder[]
  ) {
    // Add all the current workspace folders in the plugin to removed.
    for (const plugin of this.plugins) {
      removed.push(...plugin.workspaceFolders)
    }
    this.notify('workspace/didChangeWorkspaceFolders', {
      event: { added, removed },
    })

    // Add all the new workspace folders to the plugins.
    for (const plugin of this.plugins) {
      plugin.workspaceFolders = added
    }
  }

  workspaceDidCreateFiles(params: LSP.CreateFilesParams) {
    this.notify('workspace/didCreateFiles', params)
  }

  workspaceDidRenameFiles(params: LSP.RenameFilesParams) {
    this.notify('workspace/didRenameFiles', params)
  }

  workspaceDidDeleteFiles(params: LSP.DeleteFilesParams) {
    this.notify('workspace/didDeleteFiles', params)
  }

  async updateSemanticTokens(uri: string) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.semanticTokensProvider) {
      return
    }

    // Make sure we can only run, if we aren't already running.
    if (!this.isUpdatingSemanticTokens) {
      this.isUpdatingSemanticTokens = true

      const result = await this.request('textDocument/semanticTokens/full', {
        textDocument: {
          uri,
        },
      })

      this.semanticTokens = await deserializeTokens(
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
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.hoverProvider) {
      return
    }
    return await this.request('textDocument/hover', params)
  }

  async textDocumentFormatting(params: LSP.DocumentFormattingParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.documentFormattingProvider) {
      return
    }
    return await this.request('textDocument/formatting', params)
  }

  async textDocumentFoldingRange(params: LSP.FoldingRangeParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.foldingRangeProvider) {
      return
    }
    return await this.request('textDocument/foldingRange', params)
  }

  async textDocumentCompletion(params: LSP.CompletionParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.completionProvider) {
      return
    }
    const response = await this.request('textDocument/completion', params)
    return response
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

  async getCompletion(params: CopilotLspCompletionParams) {
    const response = await this.request('copilot/getCompletions', params)
    //
    this.queuedUids = [...response.completions.map((c) => c.uuid)]
    return response
  }

  async accept(uuid: string) {
    const badUids = this.queuedUids.filter((u) => u !== uuid)
    this.queuedUids = []
    this.acceptCompletion({ uuid })
    this.rejectCompletions({ uuids: badUids })
  }

  async reject() {
    const badUids = this.queuedUids
    this.queuedUids = []
    this.rejectCompletions({ uuids: badUids })
  }

  acceptCompletion(params: CopilotAcceptCompletionParams) {
    this.notify('copilot/notifyAccepted', params)
  }

  rejectCompletions(params: CopilotRejectCompletionParams) {
    this.notify('copilot/notifyRejected', params)
  }

  async updateUnits(
    params: UpdateUnitsParams
  ): Promise<UpdateUnitsResponse | null> {
    return await this.request('kcl/updateUnits', params)
  }

  async updateCanExecute(
    params: UpdateCanExecuteParams
  ): Promise<UpdateCanExecuteResponse> {
    return await this.request('kcl/updateCanExecute', params)
  }

  private processNotifications(notification: LSP.NotificationMessage) {
    for (const plugin of this.plugins) plugin.processNotification(notification)
  }
}
