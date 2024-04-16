// Code mirror language implementation for kcl.

import {
  Language,
  defineLanguageFacet,
  LanguageSupport,
} from '@codemirror/language'
import { LanguageServerClient } from 'editor/plugins/lsp'
import { kclPlugin } from '.'
import type * as LSP from 'vscode-languageserver-protocol'
import { parser as jsParser } from '@lezer/javascript'
import { EditorState } from '@uiw/react-codemirror'

const data = defineLanguageFacet({})

export interface LanguageOptions {
  workspaceFolders: LSP.WorkspaceFolder[]
  documentUri: string
  client: LanguageServerClient
}

class KclLanguage extends Language {
  constructor(options: LanguageOptions) {
    const plugin = kclPlugin({
      documentUri: options.documentUri,
      workspaceFolders: options.workspaceFolders,
      allowHTMLContent: true,
      client: options.client,
    })

    super(
      data,
      // For now let's use the javascript parser.
      // It works really well and has good syntax highlighting.
      // We can use our lsp for the rest.
      jsParser,
      [
        plugin,
        EditorState.languageData.of(() => [
          {
            // https://codemirror.net/docs/ref/#commands.CommentTokens
            commentTokens: {
              line: '//',
              block: {
                open: '/*',
                close: '*/',
              },
            },
          },
        ]),
      ],
      'kcl'
    )
  }
}

export default function kclLanguage(options: LanguageOptions): LanguageSupport {
  const lang = new KclLanguage(options)

  return new LanguageSupport(lang)
}
