// Code mirror language implementation for kcl.
import { LanguageSupport } from '@codemirror/language'
import { KclLanguage } from '@kittycad/codemirror-lang-kcl'
import {
  LanguageServerClient,
  LanguageServerPlugin,
} from '@kittycad/codemirror-lsp-client'
import type * as LSP from 'vscode-languageserver-protocol'

import { kclPlugin } from '.'
import { colorPicker } from './colors'

export interface LanguageOptions {
  workspaceFolders: LSP.WorkspaceFolder[]
  documentUri: string
  client: LanguageServerClient
  processLspNotification?: (
    plugin: LanguageServerPlugin,
    notification: LSP.NotificationMessage
  ) => void
}

export function kcl(options: LanguageOptions) {
  return new LanguageSupport(KclLanguage, [
    colorPicker,
    kclPlugin({
      documentUri: options.documentUri,
      workspaceFolders: options.workspaceFolders,
      allowHTMLContent: true,
      client: options.client,
      processLspNotification: options.processLspNotification,
    }),
  ])
}
