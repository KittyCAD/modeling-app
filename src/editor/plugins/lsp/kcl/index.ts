import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeCompletion,
  hasNextSnippetField,
  moveCompletionSelection,
  nextSnippetField,
  prevSnippetField,
  startCompletion,
} from '@codemirror/autocomplete'
import { Extension, EditorState, Prec } from '@codemirror/state'
import {
  ViewPlugin,
  hoverTooltip,
  EditorView,
  keymap,
  KeyBinding,
  tooltips,
  PluginValue,
  ViewUpdate,
} from '@codemirror/view'
import { CompletionTriggerKind } from 'vscode-languageserver-protocol'
import { offsetToPos } from 'editor/plugins/lsp/util'
import { LanguageServerOptions } from 'editor/plugins/lsp'
import { syntaxTree, indentService, foldService } from '@codemirror/language'
import { linter, forEachDiagnostic, Diagnostic } from '@codemirror/lint'
import {
  docPathFacet,
  LanguageServerPlugin,
  languageId,
  workspaceFolders,
  updateInfo,
  RelevantUpdate,
  TransactionAnnotation,
} from 'editor/plugins/lsp/plugin'
import { deferExecution } from 'lib/utils'
import { codeManager, editorManager, kclManager } from 'lib/singletons'

const changesDelay = 600

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

export const relevantUpdate = (update: ViewUpdate): RelevantUpdate => {
  const infos = updateInfo(update)
  // Make sure we are not in a snippet
  if (infos.some((info) => info.inSnippet)) {
    return {
      overall: false,
      userSelect: false,
      time: null,
    }
  }
  return {
    overall: infos.some(
      (info) =>
        info.docChanged ||
        info.annotations.includes(TransactionAnnotation.UserSelect) ||
        info.annotations.includes(TransactionAnnotation.UserInput) ||
        info.annotations.includes(TransactionAnnotation.UserDelete) ||
        info.annotations.includes(TransactionAnnotation.UserUndo) ||
        info.annotations.includes(TransactionAnnotation.UserRedo) ||
        info.annotations.includes(TransactionAnnotation.UserMove) ||
        info.annotations.includes(TransactionAnnotation.CodeManager)
    ),
    userSelect: infos.some((info) =>
      info.annotations.includes(TransactionAnnotation.UserSelect)
    ),
    time: infos.length ? infos[0].time : null,
  }
}

// A view plugin that requests completions from the server after a delay
export class KclPlugin implements PluginValue {
  private viewUpdate: ViewUpdate | null = null

  private _deffererCodeUpdate = deferExecution(() => {
    if (this.viewUpdate === null) {
      return
    }

    kclManager.executeCode()
  }, changesDelay)

  private _deffererUserSelect = deferExecution(() => {
    if (this.viewUpdate === null) {
      return
    }

    editorManager.handleOnViewUpdate(this.viewUpdate)
  }, 50)

  update(viewUpdate: ViewUpdate) {
    this.viewUpdate = viewUpdate
    editorManager.setEditorView(viewUpdate.view)

    const isRelevant = relevantUpdate(viewUpdate)
    if (!isRelevant.overall) {
      return
    }

    // If we have a user select event, we want to update what parts are
    // highlighted.
    if (isRelevant.userSelect) {
      this._deffererUserSelect(true)
      return
    }

    if (!viewUpdate.docChanged) {
      return
    }

    const newCode = viewUpdate.state.doc.toString()
    codeManager.code = newCode
    codeManager.writeToFile()

    this._deffererCodeUpdate(true)
  }
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

  const autocompleteKeymap: readonly KeyBinding[] = [
    { key: 'Ctrl-Space', run: startCompletion },
    {
      key: 'Escape',
      run: (view: EditorView): boolean => {
        if (clearSnippet(view)) return true

        return closeCompletion(view)
      },
    },
    { key: 'ArrowDown', run: moveCompletionSelection(true) },
    { key: 'ArrowUp', run: moveCompletionSelection(false) },
    { key: 'PageDown', run: moveCompletionSelection(true, 'page') },
    { key: 'PageUp', run: moveCompletionSelection(false, 'page') },
    { key: 'Enter', run: acceptCompletion },
    {
      key: 'Tab',
      run: (view: EditorView): boolean => {
        if (hasNextSnippetField(view.state)) {
          const result = nextSnippetField(view)
          return result
        }

        return acceptCompletion(view)
      },
      shift: prevSnippetField,
    },
  ]

  const autocompleteKeymapExt = Prec.highest(
    keymap.computeN([], () => [autocompleteKeymap])
  )

  const folding = foldService.of(
    (state: EditorState, lineStart: number, lineEnd: number) => {
      if (plugin == null) return null

      // Get the folding ranges from the language server.
      // Since this is async we directly need to update the folding ranges after.
      return plugin?.foldingRange(lineStart, lineEnd)
    }
  )

  return [
    docPathFacet.of(options.documentUri),
    languageId.of('kcl'),
    workspaceFolders.of(options.workspaceFolders),
    viewPlugin,
    ViewPlugin.define((view) => new KclPlugin()),
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
    autocompleteKeymapExt,
    autocompletion({
      defaultKeymap: false,
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
