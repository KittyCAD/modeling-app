import { Compartment, Prec, type Extension } from '@codemirror/state'
import type {
  LanguageServerClient,
  LanguageServerPlugin,
} from '@kittycad/codemirror-lsp-client'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { kcl } from '@src/lang/lsp/kcl/language'
import type { KclLspEditor } from '@src/lang/lsp/types'
import type * as LSP from 'vscode-languageserver-protocol'

const kclLspCompartment = new Compartment()

function getWorkspaceFolders(): LSP.WorkspaceFolder[] {
  return []
}

export function kclLspExtension(): Extension {
  return kclLspCompartment.of([])
}

export function getKclLspDocumentPath(kclManager: KclLspEditor): string {
  return kclManager.path || PROJECT_ENTRYPOINT
}

export function attachKclLspToCodeMirror(
  kclManager: KclLspEditor,
  client: LanguageServerClient
): () => void {
  const lspExtension = kcl({
    documentUri: getKclLspDocumentPath(kclManager),
    workspaceFolders: getWorkspaceFolders(),
    client,
    processLspNotification: processKclLspNotification,
  })

  kclManager.editorView.dispatch({
    effects: kclLspCompartment.reconfigure(Prec.highest(lspExtension)),
  })

  return () => {
    kclManager.editorView.dispatch({
      effects: kclLspCompartment.reconfigure(Prec.highest([])),
    })
  }
}

function processKclLspNotification(
  plugin: LanguageServerPlugin,
  notification: LSP.NotificationMessage
) {
  try {
    switch (notification.method) {
      case 'kcl/astUpdated':
        // Update the folding ranges since CodeMirror does not support async foldService.
        void plugin.updateFoldingRanges()
        void plugin.requestSemanticTokens()
        break
    }
  } catch (error) {
    console.error(error)
  }
}
