// Code mirror language implementation for kcl.

import {
  Language,
  defineLanguageFacet,
  LanguageSupport,
} from '@codemirror/language'
import { LanguageServerClient } from '.'
import { kclPlugin } from './plugin'
import type * as LSP from 'vscode-languageserver-protocol'
import { parser as jsParser } from '@lezer/javascript'

const data = defineLanguageFacet({})

export interface LanguageOptions {
  workspaceFolders: LSP.WorkspaceFolder[] | null
  documentUri: string
  client: LanguageServerClient
}

export default function kclLanguage(options: LanguageOptions): LanguageSupport {
  // For now let's use the javascript parser.
  // It works really well and has good syntax highlighting.
  // We can use our lsp for the rest.
  const lang = new Language(data, jsParser, [], 'kcl')

  // Create our supporting extension.
  const kclLsp = kclPlugin({
    documentUri: options.documentUri,
    workspaceFolders: options.workspaceFolders,
    allowHTMLContent: true,
    client: options.client,
  })

  return new LanguageSupport(lang, [kclLsp])
}
