import { autocompletion } from '@codemirror/autocomplete'
import { Extension, EditorState, Prec } from '@codemirror/state'
import {
  ViewPlugin,
  hoverTooltip,
  EditorView,
  keymap,
  KeyBinding,
  tooltips,
} from '@codemirror/view'
import { CompletionTriggerKind } from 'vscode-languageserver-protocol'
import { offsetToPos } from 'editor/plugins/lsp/util'
import { LanguageServerOptions } from 'editor/plugins/lsp'
import { syntaxTree, indentService, foldService } from '@codemirror/language'
import { linter, forEachDiagnostic, Diagnostic } from '@codemirror/lint'
import {
  LanguageServerPlugin,
  documentUri,
  languageId,
  workspaceFolders,
} from 'editor/plugins/lsp/plugin'

export const kclIndentService = () => {
  // Match the indentation of the previous line (if present).
  return indentService.of((context, pos) => {
    try {
      const previousLine = context.lineAt(pos, -1)
      const previousLineText = previousLine.text.replaceAll(
        '\t',
        ' '.repeat(context.state.tabSize)
      )
      const match = previousLineText.match(/^(\s)*/)
      if (match === null || match.length <= 0) return null
      return match[0].length
    } catch (err) {
      console.error('Error in codemirror indentService', err)
    }
    return null
  })
}

export function kclPlugin(options: LanguageServerOptions): Extension {
  let plugin: LanguageServerPlugin | null = null
  const viewPlugin = ViewPlugin.define(
    (view) =>
      (plugin = new LanguageServerPlugin(
        options.client,
        view,
        options.allowHTMLContent
      ))
  )

  const kclKeymap: readonly KeyBinding[] = [
    {
      key: 'Alt-Shift-f',
      run: (view: EditorView) => {
        if (view.plugin === null) return false

        // Get the current plugin from the map.
        const p = view.plugin(viewPlugin)

        if (p === null) return false
        p.requestFormatting()
        return true
      },
    },
  ]
  // Create an extension for the key mappings.
  const kclKeymapExt = Prec.highest(keymap.computeN([], () => [kclKeymap]))

  const folding = foldService.of(
    (state: EditorState, lineStart: number, lineEnd: number) => {
      if (plugin == null) return null

      // Get the folding ranges from the language server.
      // Since this is async we directly need to update the folding ranges after.
      return plugin?.foldingRange(lineStart, lineEnd)
    }
  )

  return [
    documentUri.of(options.documentUri),
    languageId.of('kcl'),
    workspaceFolders.of(options.workspaceFolders),
    viewPlugin,
    kclKeymapExt,
    kclIndentService(),
    hoverTooltip(
      (view, pos) =>
        plugin?.requestHoverTooltip(view, offsetToPos(view.state.doc, pos)) ??
        null
    ),
    tooltips({
      position: 'absolute',
    }),
    linter((view) => {
      let diagnostics: Diagnostic[] = []
      forEachDiagnostic(
        view.state,
        (d: Diagnostic, from: number, to: number) => {
          diagnostics.push(d)
        }
      )
      return diagnostics
    }),
    folding,
    autocompletion({
      defaultKeymap: true,
      override: [
        async (context) => {
          if (plugin == null) return null

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
    }),
  ]
}
