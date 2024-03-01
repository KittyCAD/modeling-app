import { autocompletion } from '@codemirror/autocomplete'
import { Extension } from '@codemirror/state'
import { ViewPlugin, hoverTooltip, tooltips } from '@codemirror/view'
import { CompletionTriggerKind } from 'vscode-languageserver-protocol'
import { offsetToPos } from 'editor/plugins/lsp/util'
import { LanguageServerOptions } from 'editor/plugins/lsp'
import {
  LanguageServerPlugin,
  documentUri,
  languageId,
  workspaceFolders,
} from 'editor/plugins/lsp/plugin'

export function kclPlugin(options: LanguageServerOptions): Extension {
  let plugin: LanguageServerPlugin | null = null

  return [
    documentUri.of(options.documentUri),
    languageId.of('kcl'),
    workspaceFolders.of(options.workspaceFolders),
    ViewPlugin.define(
      (view) =>
        (plugin = new LanguageServerPlugin(
          options.client,
          view,
          options.allowHTMLContent
        ))
    ),
    hoverTooltip(
      (view, pos) =>
        plugin?.requestHoverTooltip(view, offsetToPos(view.state.doc, pos)) ??
        null
    ),
    tooltips({
      position: 'absolute',
    }),
    autocompletion({
      override: [
        async (context) => {
          if (plugin == null) return null

          const { state, pos, explicit } = context
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

          // Get if we are in a comment token.
          const tokens = state.languageDataAt('commentTokens', pos)
          if (tokens && tokens.length > 0) {
            // We are in a comment token, we should not trigger completion.
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
    }),
  ]
}
