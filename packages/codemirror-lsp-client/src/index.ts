import { autocompletion } from '@codemirror/autocomplete'
import { foldService, syntaxTree } from '@codemirror/language'
import { Extension, EditorState } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'

import { CompletionTriggerKind } from 'vscode-languageserver-protocol'

import {
  docPathFacet,
  LanguageServerPlugin,
  LanguageServerPluginSpec,
  languageId,
  workspaceFolders,
  LanguageServerOptions,
} from './plugin/lsp'
import { offsetToPos } from './plugin/util'

export type { LanguageServerClientOptions } from './client'
export { LanguageServerClient } from './client'
export {
  Codec,
  FromServer,
  IntoServer,
  LspWorkerEventType,
} from './client/codec'
export type { LanguageServerOptions } from './plugin/lsp'
export type { TransactionInfo, RelevantUpdate } from './plugin/annotations'
export { updateInfo, TransactionAnnotation } from './plugin/annotations'
export {
  LanguageServerPlugin,
  LanguageServerPluginSpec,
  docPathFacet,
  languageId,
  workspaceFolders,
} from './plugin/lsp'
export { posToOffset, offsetToPos } from './plugin/util'

export function lspPlugin(options: LanguageServerOptions): Extension {
  let plugin: LanguageServerPlugin | null = null
  const viewPlugin = ViewPlugin.define(
    (view) => (plugin = new LanguageServerPlugin(options, view)),
    new LanguageServerPluginSpec()
  )

  let ext = [
    docPathFacet.of(options.documentUri),
    languageId.of('kcl'),
    workspaceFolders.of(options.workspaceFolders),
    viewPlugin,
    foldService.of((state: EditorState, lineStart: number, lineEnd: number) => {
      if (plugin == null) return null
      // Get the folding ranges from the language server.
      // Since this is async we directly need to update the folding ranges after.
      return plugin?.foldingRange(lineStart, lineEnd)
    }),
  ]

  if (options.client.getServerCapabilities().completionProvider) {
    ext.push(
      autocompletion({
        defaultKeymap: false,
        override: [
          async (context) => {
            if (plugin === null) {
              return null
            }

            const { state, pos, explicit } = context

            let nodeBefore = syntaxTree(state).resolveInner(pos, -1)
            if (
              nodeBefore.name === 'BlockComment' ||
              nodeBefore.name === 'LineComment'
            )
              return null

            const line = state.doc.lineAt(pos)
            let trigKind: CompletionTriggerKind = CompletionTriggerKind.Invoked
            let trigChar: string | undefined
            if (
              !explicit &&
              plugin.client
                .getServerCapabilities()
                .completionProvider?.triggerCharacters?.includes(
                  line.text[pos - line.from - 1]
                )
            ) {
              trigKind = CompletionTriggerKind.TriggerCharacter
              trigChar = line.text[pos - line.from - 1]
            }
            if (
              trigKind === CompletionTriggerKind.Invoked &&
              !context.matchBefore(/\w+$/)
            ) {
              return null
            }

            return await plugin.requestCompletion(
              context,
              offsetToPos(state.doc, pos),
              {
                triggerKind: trigKind,
                triggerCharacter: trigChar,
              }
            )
          },
        ],
      })
    )
  }

  return ext
}
