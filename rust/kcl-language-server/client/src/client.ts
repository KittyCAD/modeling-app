/* eslint suggest-no-throw/suggest-no-throw: 0 */
import * as lc from 'vscode-languageclient/node'
import type * as vscode from 'vscode'

export async function createClient(
  traceOutputChannel: vscode.OutputChannel,
  outputChannel: vscode.OutputChannel,
  initializationOptions: vscode.WorkspaceConfiguration,
  serverOptions: lc.ServerOptions
): Promise<lc.LanguageClient> {
  const clientOptions: lc.LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'kcl' }],
    initializationOptions,
    traceOutputChannel,
    outputChannel,
    middleware: {
      workspace: {
        // HACK: This is a workaround, when the client has been disposed, VSCode
        // continues to emit events to the client and the default one for this event
        // attempt to restart the client for no reason
        async didChangeWatchedFile(event, next) {
          if (client.isRunning()) {
            await next(event)
          }
        },
        async configuration(
          params: lc.ConfigurationParams,
          token: vscode.CancellationToken,
          next: lc.ConfigurationRequest.HandlerSignature
        ) {
          const resp = await next(params, token)
          return resp
        },
      },
    },
  }

  const client = new lc.LanguageClient(
    'kcl-language-server',
    'KittyCAD Language Server',
    serverOptions,
    clientOptions
  )

  client.registerFeature(new ExperimentalFeatures())

  return client
}

class ExperimentalFeatures implements lc.StaticFeature {
  getState(): lc.FeatureState {
    return { kind: 'static' }
  }
  fillClientCapabilities(capabilities: lc.ClientCapabilities): void {
    capabilities.experimental = {
      snippetTextEdit: true,
      codeActionGroup: true,
      hoverActions: true,
      serverStatusNotification: true,
      colorDiagnosticOutput: true,
      openServerLogs: true,
      commands: {
        commands: ['editor.action.triggerParameterHints'],
      },
      ...capabilities.experimental,
    }
  }
  initialize(
    _capabilities: lc.ServerCapabilities,
    _documentSelector: lc.DocumentSelector | undefined
  ): void {}
  dispose(): void {}
  clear(): void {}
}
