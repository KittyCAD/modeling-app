import { autocompletion, completeFromList } from '@codemirror/autocomplete'
import { setDiagnostics } from '@codemirror/lint'
import { Facet } from '@codemirror/state'
import {
  EditorView,
  ViewPlugin,
  Tooltip,
  hoverTooltip,
  tooltips,
} from '@codemirror/view'
import {
  DiagnosticSeverity,
  CompletionItemKind,
  CompletionTriggerKind,
} from 'vscode-languageserver-protocol'
import debounce from 'debounce-promise'

import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import type { ViewUpdate, PluginValue } from '@codemirror/view'
import type { Text } from '@codemirror/state'
import type * as LSP from 'vscode-languageserver-protocol'
import { LanguageServerClient, Notification } from '.'
import { Marked } from '@ts-stack/markdown'

const changesDelay = 500

const CompletionItemKindMap = Object.fromEntries(
  Object.entries(CompletionItemKind).map(([key, value]) => [value, key])
) as Record<CompletionItemKind, string>

const useLast = (values: readonly any[]) => values.reduce((_, v) => v, '')
const documentUri = Facet.define<string, string>({ combine: useLast })
const languageId = Facet.define<string, string>({ combine: useLast })
const client = Facet.define<LanguageServerClient, LanguageServerClient>({
  combine: useLast,
})

export interface LanguageServerOptions {
  workspaceFolders: LSP.WorkspaceFolder[] | null
  documentUri: string
  allowHTMLContent: boolean
  client: LanguageServerClient
}

export class LanguageServerPlugin implements PluginValue {
  public client: LanguageServerClient

  private documentUri: string
  private languageId: string
  private documentVersion: number

  constructor(private view: EditorView, private allowHTMLContent: boolean) {
    this.client = this.view.state.facet(client)
    this.documentUri = this.view.state.facet(documentUri)
    this.languageId = this.view.state.facet(languageId)
    this.documentVersion = 0

    this.client.attachPlugin(this)

    this.initialize({
      documentText: this.view.state.doc.toString(),
    })
  }

  update({ docChanged }: ViewUpdate) {
    if (!docChanged) return

    this.sendChange({
      documentText: this.view.state.doc.toString(),
    })
  }

  destroy() {
    this.client.detachPlugin(this)
  }

  async initialize({ documentText }: { documentText: string }) {
    if (this.client.initializePromise) {
      await this.client.initializePromise
    }
    this.client.textDocumentDidOpen({
      textDocument: {
        uri: this.documentUri,
        languageId: this.languageId,
        text: documentText,
        version: this.documentVersion,
      },
    })
  }

  async sendChange({ documentText }: { documentText: string }) {
    if (!this.client.ready) return

    if (documentText.length > 5000) {
      // Clear out the text it thinks we have, large documents will throw a stack error.
      // This is obviously not a good fix but it works for now til we figure
      // out the stack limits in wasm and also rewrite the parser.
      // Since this is only for hover and completions it will be fine,
      // completions will still work for stdlib but hover will not.
      // That seems like a fine trade-off for a working editor for the time
      // being.
      documentText = ''
    }

    try {
      debounce(
        () => {
          return this.client.textDocumentDidChange({
            textDocument: {
              uri: this.documentUri,
              version: this.documentVersion++,
            },
            contentChanges: [{ text: documentText }],
          })
        },
        changesDelay,
        { leading: true }
      )
    } catch (e) {
      console.error(e)
    }
  }

  requestDiagnostics(view: EditorView) {
    this.sendChange({ documentText: view.state.doc.toString() })
  }

  async requestHoverTooltip(
    view: EditorView,
    { line, character }: { line: number; character: number }
  ): Promise<Tooltip | null> {
    if (
      !this.client.ready ||
      !this.client.getServerCapabilities().hoverProvider
    )
      return null

    this.sendChange({ documentText: view.state.doc.toString() })
    const result = await this.client.textDocumentHover({
      textDocument: { uri: this.documentUri },
      position: { line, character },
    })
    if (!result) return null
    const { contents, range } = result
    let pos = posToOffset(view.state.doc, { line, character })!
    let end: number | undefined
    if (range) {
      pos = posToOffset(view.state.doc, range.start)!
      end = posToOffset(view.state.doc, range.end)
    }
    if (pos === null) return null
    const dom = document.createElement('div')
    dom.classList.add('documentation')
    if (this.allowHTMLContent) dom.innerHTML = formatContents(contents)
    else dom.textContent = formatContents(contents)
    return { pos, end, create: (view) => ({ dom }), above: true }
  }

  async requestCompletion(
    context: CompletionContext,
    { line, character }: { line: number; character: number },
    {
      triggerKind,
      triggerCharacter,
    }: {
      triggerKind: CompletionTriggerKind
      triggerCharacter: string | undefined
    }
  ): Promise<CompletionResult | null> {
    if (
      !this.client.ready ||
      !this.client.getServerCapabilities().completionProvider
    )
      return null

    this.sendChange({
      documentText: context.state.doc.toString(),
    })

    const result = await this.client.textDocumentCompletion({
      textDocument: { uri: this.documentUri },
      position: { line, character },
      context: {
        triggerKind,
        triggerCharacter,
      },
    })

    if (!result) return null

    const items = 'items' in result ? result.items : result

    let options = items.map(
      ({
        detail,
        label,
        labelDetails,
        kind,
        textEdit,
        documentation,
        deprecated,
        insertText,
        insertTextFormat,
        sortText,
        filterText,
      }) => {
        const completion: Completion & {
          filterText: string
          sortText?: string
          apply: string
        } = {
          label,
          detail: labelDetails ? labelDetails.detail : detail,
          apply: label,
          type: kind && CompletionItemKindMap[kind].toLowerCase(),
          sortText: sortText ?? label,
          filterText: filterText ?? label,
        }
        if (documentation) {
          completion.info = () => {
            const htmlString = formatContents(documentation)
            const htmlNode = document.createElement('div')
            htmlNode.style.display = 'contents'
            htmlNode.innerHTML = htmlString
            return { dom: htmlNode }
          }
        }

        return completion
      }
    )

    return completeFromList(options)(context)
  }

  processNotification(notification: Notification) {
    try {
      switch (notification.method) {
        case 'textDocument/publishDiagnostics':
          this.processDiagnostics(notification.params)
      }
    } catch (error) {
      console.error(error)
    }
  }

  processDiagnostics(params: PublishDiagnosticsParams) {
    if (params.uri !== this.documentUri) return

    const diagnostics = params.diagnostics
      .map(({ range, message, severity }) => ({
        from: posToOffset(this.view.state.doc, range.start)!,
        to: posToOffset(this.view.state.doc, range.end)!,
        severity: (
          {
            [DiagnosticSeverity.Error]: 'error',
            [DiagnosticSeverity.Warning]: 'warning',
            [DiagnosticSeverity.Information]: 'info',
            [DiagnosticSeverity.Hint]: 'info',
          } as const
        )[severity!],
        message,
      }))
      .filter(
        ({ from, to }) =>
          from !== null && to !== null && from !== undefined && to !== undefined
      )
      .sort((a, b) => {
        switch (true) {
          case a.from < b.from:
            return -1
          case a.from > b.from:
            return 1
        }
        return 0
      })

    this.view.dispatch(setDiagnostics(this.view.state, diagnostics))
  }
}

export function kclPlugin(options: LanguageServerOptions) {
  let plugin: LanguageServerPlugin | null = null

  return [
    client.of(options.client),
    documentUri.of(options.documentUri),
    languageId.of('kcl'),
    ViewPlugin.define(
      (view) =>
        (plugin = new LanguageServerPlugin(view, options.allowHTMLContent))
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

export function posToOffset(
  doc: Text,
  pos: { line: number; character: number }
): number | undefined {
  if (pos.line >= doc.lines) return
  const offset = doc.line(pos.line + 1).from + pos.character
  if (offset > doc.length) return
  return offset
}

function offsetToPos(doc: Text, offset: number) {
  const line = doc.lineAt(offset)
  return {
    line: line.number - 1,
    character: offset - line.from,
  }
}

function formatContents(
  contents: LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[]
): string {
  if (Array.isArray(contents)) {
    return contents.map((c) => formatContents(c) + '\n\n').join('')
  } else if (typeof contents === 'string') {
    return Marked.parse(contents)
  } else {
    return Marked.parse(contents.value)
  }
}
