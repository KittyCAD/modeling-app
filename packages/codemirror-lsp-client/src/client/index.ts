import type * as LSP from 'vscode-languageserver-protocol'

import type { LanguageServerPlugin } from '../plugin/lsp'
import type { FromServer, IntoServer } from './codec'
import Client from './jsonrpc'

// https://microsoft.github.io/language-server-protocol/specifications/specification-current/

// Client to server then server to client
interface LSPRequestMap {
  initialize: [LSP.InitializeParams, LSP.InitializeResult]
  'textDocument/hover': [LSP.HoverParams, LSP.Hover]
  'textDocument/completion': [
    LSP.CompletionParams,
    LSP.CompletionItem[] | LSP.CompletionList | null,
  ]
  'completionItem/resolve': [LSP.CompletionItem, LSP.CompletionItem]
  'textDocument/semanticTokens/full': [
    LSP.SemanticTokensParams,
    LSP.SemanticTokens,
  ]
  'textDocument/formatting': [
    LSP.DocumentFormattingParams,
    LSP.TextEdit[] | null,
  ]
  'textDocument/foldingRange': [LSP.FoldingRangeParams, LSP.FoldingRange[]]
  'textDocument/signatureHelp': [
    LSP.SignatureHelpParams,
    LSP.SignatureHelp | null,
  ]
  'textDocument/codeAction': [
    LSP.CodeActionParams,
    (LSP.Command | LSP.CodeAction)[] | null,
  ]
  'textDocument/rename': [LSP.RenameParams, LSP.WorkspaceEdit | null]
  'textDocument/prepareRename': [
    LSP.PrepareRenameParams,
    LSP.Range | LSP.PrepareRenameResult | null,
  ]
  'textDocument/definition': [
    LSP.DefinitionParams,
    LSP.Definition | LSP.DefinitionLink[] | null,
  ]
  'textDocument/documentColor': [
    LSP.DocumentColorParams,
    LSP.ColorInformation[] | null,
  ]
  'textDocument/colorPresentation': [
    LSP.ColorPresentationParams,
    LSP.ColorPresentation[] | null,
  ]
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
}

export interface LanguageServerClientOptions {
  name: string
  fromServer: FromServer
  intoServer: IntoServer
  initializedCallback: () => void
}

export class LanguageServerClient {
  private client: Client
  readonly name: string

  public ready: boolean

  readonly plugins: LanguageServerPlugin[]

  public initializePromise: Promise<void>

  constructor(options: LanguageServerClientOptions) {
    this.name = options.name
    this.plugins = []

    this.client = new Client(
      options.fromServer,
      options.intoServer,
      options.initializedCallback
    )

    this.ready = false

    this.initializePromise = this.initialize()
  }

  async initialize() {
    // Start the client in the background.
    this.client.setNotifyFn(this.processNotifications.bind(this))
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
  }

  textDocumentDidChange(params: LSP.DidChangeTextDocumentParams) {
    this.notify('textDocument/didChange', params)
  }

  textDocumentDidClose(params: LSP.DidCloseTextDocumentParams) {
    this.notify('textDocument/didClose', params)
  }

  workspaceDidChangeWorkspaceFolders(
    added: LSP.WorkspaceFolder[],
    removed: LSP.WorkspaceFolder[]
  ) {
    this.notify('workspace/didChangeWorkspaceFolders', {
      event: { added, removed },
    })
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

  async textDocumentSemanticTokensFull(params: LSP.SemanticTokensParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.semanticTokensProvider) {
      return null
    }

    return this.request('textDocument/semanticTokens/full', params)
  }

  async textDocumentHover(params: LSP.HoverParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.hoverProvider) {
      return null
    }
    return await this.request('textDocument/hover', params)
  }

  async textDocumentFormatting(params: LSP.DocumentFormattingParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.documentFormattingProvider) {
      return null
    }
    return await this.request('textDocument/formatting', params)
  }

  async textDocumentFoldingRange(params: LSP.FoldingRangeParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.foldingRangeProvider) {
      return null
    }
    return await this.request('textDocument/foldingRange', params)
  }

  async textDocumentCompletion(params: LSP.CompletionParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.completionProvider) {
      return null
    }
    return await this.request('textDocument/completion', params)
  }

  async completionItemResolve(params: LSP.CompletionItem) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.completionProvider) {
      return null
    }
    return await this.request('completionItem/resolve', params)
  }

  async textDocumentSignatureHelp(params: LSP.SignatureHelpParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.signatureHelpProvider) {
      return null
    }
    return await this.request('textDocument/signatureHelp', params)
  }

  async textDocumentCodeAction(params: LSP.CodeActionParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.codeActionProvider) {
      return null
    }
    return await this.request('textDocument/codeAction', params)
  }

  async textDocumentRename(params: LSP.RenameParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.renameProvider) {
      return null
    }

    return await this.request('textDocument/rename', params)
  }

  async textDocumentPrepareRename(params: LSP.PrepareRenameParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.renameProvider) {
      return null
    }
    return await this.request('textDocument/prepareRename', params)
  }

  async textDocumentDefinition(params: LSP.DefinitionParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.definitionProvider) {
      return null
    }
    return await this.request('textDocument/definition', params)
  }

  async textDocumentDocumentColor(params: LSP.DocumentColorParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.colorProvider) {
      return null
    }
    return await this.request('textDocument/documentColor', params)
  }

  async textDocumentColorPresentation(params: LSP.ColorPresentationParams) {
    const serverCapabilities = this.getServerCapabilities()
    if (!serverCapabilities.colorProvider) {
      return null
    }
    return await this.request('textDocument/colorPresentation', params)
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

  requestCustom<P, R>(method: string, params: P): Promise<R> {
    return this.client.request(method, params) as Promise<R>
  }

  private notify<K extends keyof LSPNotifyMap>(
    method: K,
    params: LSPNotifyMap[K]
  ): void {
    return this.client.notify(method, params)
  }

  notifyCustom<P>(method: string, params: P): void {
    return this.client.notify(method, params)
  }

  private processNotifications(notification: LSP.NotificationMessage) {
    for (const plugin of this.plugins) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      plugin.processNotification(notification)
    }
  }
}
