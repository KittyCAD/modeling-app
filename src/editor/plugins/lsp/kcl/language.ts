// Code mirror language implementation for kcl.

import {
  LRLanguage,
  LanguageSupport,
  indentNodeProp,
  continuedIndent,
  delimitedIndent,
  foldNodeProp,
  foldInside,
} from '@codemirror/language'
import {
  LanguageServerClient,
  LanguageServerPlugin,
} from '@kittycad/codemirror-lsp-client'
import { kclPlugin } from '.'
import type * as LSP from 'vscode-languageserver-protocol'
// @ts-ignore: No types available
import { parser } from './kcl.grammar'
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

export const KclLanguage = LRLanguage.define({
  name: 'kcl',
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Body: delimitedIndent({ closing: '}' }),
        BlockComment: () => null,
        'Statement Property': continuedIndent({ except: /^{/ }),
      }),
      foldNodeProp.add({
        'Body ArrayExpression ObjectExpression': foldInside,
        BlockComment(tree) {
          return { from: tree.from + 2, to: tree.to - 2 }
        },
        PipeExpression(tree) {
          return { from: tree.firstChild!.to, to: tree.to }
        },
      }),
    ],
  }),
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
  },
})

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
