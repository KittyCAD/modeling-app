import type {
  Registration,
  ServerCapabilities,
  Unregistration,
} from 'vscode-languageserver-protocol'

interface IFlexibleServerCapabilities extends ServerCapabilities {
  [key: string]: any
}

interface IMethodServerCapabilityProviderDictionary {
  [key: string]: string
}

const ServerCapabilitiesProviders: IMethodServerCapabilityProviderDictionary = {
  'textDocument/hover': 'hoverProvider',
  'textDocument/completion': 'completionProvider',
  'textDocument/signatureHelp': 'signatureHelpProvider',
  'textDocument/definition': 'definitionProvider',
  'textDocument/typeDefinition': 'typeDefinitionProvider',
  'textDocument/implementation': 'implementationProvider',
  'textDocument/references': 'referencesProvider',
  'textDocument/documentHighlight': 'documentHighlightProvider',
  'textDocument/documentSymbol': 'documentSymbolProvider',
  'textDocument/workspaceSymbol': 'workspaceSymbolProvider',
  'textDocument/codeAction': 'codeActionProvider',
  'textDocument/codeLens': 'codeLensProvider',
  'textDocument/documentFormatting': 'documentFormattingProvider',
  'textDocument/documentRangeFormatting': 'documentRangeFormattingProvider',
  'textDocument/documentOnTypeFormatting': 'documentOnTypeFormattingProvider',
  'textDocument/rename': 'renameProvider',
  'textDocument/documentLink': 'documentLinkProvider',
  'textDocument/color': 'colorProvider',
  'textDocument/foldingRange': 'foldingRangeProvider',
  'textDocument/declaration': 'declarationProvider',
  'textDocument/executeCommand': 'executeCommandProvider',
  'textDocument/semanticTokens/full': 'semanticTokensProvider',
  'textDocument/publishDiagnostics': 'diagnosticsProvider',
}

function registerServerCapability(
  serverCapabilities: ServerCapabilities,
  registration: Registration
): ServerCapabilities | Error {
  const serverCapabilitiesCopy = structuredClone(
    serverCapabilities
  ) as IFlexibleServerCapabilities
  const { method, registerOptions } = registration
  const providerName = ServerCapabilitiesProviders[method]

  if (providerName) {
    if (!registerOptions) {
      serverCapabilitiesCopy[providerName] = true
    } else {
      serverCapabilitiesCopy[providerName] = Object.assign(
        {},
        structuredClone(registerOptions)
      )
    }
  } else {
    return new Error('Could not register server capability.')
  }

  return serverCapabilitiesCopy
}

function unregisterServerCapability(
  serverCapabilities: ServerCapabilities,
  unregistration: Unregistration
): ServerCapabilities {
  const serverCapabilitiesCopy = structuredClone(
    serverCapabilities
  ) as IFlexibleServerCapabilities
  const { method } = unregistration
  const providerName = ServerCapabilitiesProviders[method]

  delete serverCapabilitiesCopy[providerName]

  return serverCapabilitiesCopy
}

export { registerServerCapability, unregisterServerCapability }
