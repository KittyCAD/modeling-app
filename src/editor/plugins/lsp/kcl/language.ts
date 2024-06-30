// Code mirror language implementation for kcl.

import {
  Language,
  defineLanguageFacet,
  LanguageSupport,
} from '@codemirror/language'
import {
  LanguageServerClient,
  LanguageServerPlugin,
} from '@kittycad/codemirror-lsp-client'
import { kclPlugin } from '.'
import type * as LSP from 'vscode-languageserver-protocol'
import KclParser from './parser'

const data = defineLanguageFacet({
  // https://codemirror.net/docs/ref/#commands.CommentTokens
  commentTokens: {
    line: '//',
    block: {
      open: '/*',
      close: '*/',
    },
  },
})

export interface LanguageOptions {
  workspaceFolders: LSP.WorkspaceFolder[]
  documentUri: string
  client: LanguageServerClient
  processLspNotification?: (
    plugin: LanguageServerPlugin,
    notification: LSP.NotificationMessage
  ) => void
}

class KclLanguage extends Language {
  constructor(options: LanguageOptions) {
    const plugin = kclPlugin({
      documentUri: options.documentUri,
      workspaceFolders: options.workspaceFolders,
      allowHTMLContent: true,
      client: options.client,
      processLspNotification: options.processLspNotification,
    })

    const parser = new KclParser()

    super(
      data,
      // For now let's use the javascript parser.
      // It works really well and has good syntax highlighting.
      // We can use our lsp for the rest.
      parser,
      [plugin],
      'kcl'
    )
  }
}

export default class KclLanguageSupport extends LanguageSupport {
  constructor(options: LanguageOptions) {
    const lang = new KclLanguage(options)

    super(lang)
  }
}
