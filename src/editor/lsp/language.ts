// Code mirror language implementation for kcl.

import KclParser from './parser'
import {
  Language,
  defineLanguageFacet,
  LanguageSupport,
} from '@codemirror/language'
import { LanguageServerClient } from '.'
import { kclPlugin } from './plugin'
import type * as LSP from 'vscode-languageserver-protocol'

const data = defineLanguageFacet({})

export interface LanguageOptions {
  workspaceFolders: LSP.WorkspaceFolder[] | null
  documentUri: string
  client: LanguageServerClient
}

export default function kclLanguage(options: LanguageOptions): LanguageSupport {
  const parser = new KclParser(options.client)
  const lang = new Language(data, parser, [], 'kcl')

  // Create our supporting extension.
  const kclLsp = kclPlugin({
    documentUri: options.documentUri,
    workspaceFolders: options.workspaceFolders,
    allowHTMLContent: true,
    client: options.client,
  })

  return new LanguageSupport(lang, [kclLsp])
}
