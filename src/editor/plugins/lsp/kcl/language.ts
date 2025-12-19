// Code mirror language implementation for kcl.
import { LanguageSupport } from '@codemirror/language'
import { KclLanguage } from '@kittycad/codemirror-lang-kcl'
import type {
  LanguageServerClient,
  LanguageServerPlugin,
} from '@kittycad/codemirror-lsp-client'
import type * as LSP from 'vscode-languageserver-protocol'

import { kclPlugin } from '@src/editor/plugins/lsp/kcl'
import { colorPicker } from '@src/editor/plugins/lsp/kcl/colors'
import type { KclManager } from '@src/lang/KclManager'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export interface LanguageOptions {
  workspaceFolders: LSP.WorkspaceFolder[]
  documentUri: string
  client: LanguageServerClient
  processLspNotification?: (
    plugin: LanguageServerPlugin,
    notification: LSP.NotificationMessage
  ) => void
}

export function kcl(
  options: LanguageOptions,
  systemDeps: {
    kclManager: KclManager
    sceneEntitiesManager: SceneEntities
    wasmInstance: ModuleType
  }
) {
  return new LanguageSupport(KclLanguage, [
    colorPicker,
    kclPlugin(
      {
        documentUri: options.documentUri,
        workspaceFolders: options.workspaceFolders,
        allowHTMLContent: true,
        client: options.client,
        processLspNotification: options.processLspNotification,
      },
      systemDeps
    ),
  ])
}
