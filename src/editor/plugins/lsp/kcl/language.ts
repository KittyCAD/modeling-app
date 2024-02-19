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

export default function kclLanguage(options: LanguageOptions): LanguageSupport {
  // For now let's use the javascript parser.
  // It works really well and has good syntax highlighting.
  // We can use our lsp for the rest.
  const lang = new Language(
    data,
    jsParser,
    [
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

  // Create our supporting extension.
  const kclLsp = kclPlugin({
    documentUri: options.documentUri,
    workspaceFolders: options.workspaceFolders,
    allowHTMLContent: true,
    client: options.client,
  })

  return new LanguageSupport(lang, [kclLsp])
}
