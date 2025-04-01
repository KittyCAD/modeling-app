import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import { completeFromList, snippetCompletion } from '@codemirror/autocomplete'
import {
  Facet,
  StateEffect,
  Extension,
  Transaction,
  Annotation,
} from '@codemirror/state'
import type {
  ViewUpdate,
  PluginValue,
  PluginSpec,
  ViewPlugin,
} from '@codemirror/view'
import { EditorView, Tooltip } from '@codemirror/view'
import { linter } from '@codemirror/lint'

import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import type * as LSP from 'vscode-languageserver-protocol'
import {
  DiagnosticSeverity,
  CompletionTriggerKind,
} from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'

import { LanguageServerClient } from '../client'
import { CompletionItemKindMap } from './autocomplete'
import { addToken, SemanticToken } from './semantic-tokens'
import { posToOffset, formatMarkdownContents } from './util'
import lspAutocompleteExt from './autocomplete'
import lspHoverExt from './hover'
import lspFormatExt from './format'
import lspIndentExt from './indent'
import lspSemanticTokensExt from './semantic-tokens'

const useLast = (values: readonly any[]) => values.reduce((_, v) => v, '')
export const docPathFacet = Facet.define<string, string>({
  combine: useLast,
})
export const languageId = Facet.define<string, string>({ combine: useLast })
export const workspaceFolders = Facet.define<
  LSP.WorkspaceFolder[],
  LSP.WorkspaceFolder[]
>({ combine: useLast })

export enum LspAnnotation {
  SemanticTokens = 'semantic-tokens',
  FormatCode = 'format-code',
  Diagnostics = 'diagnostics',
}

const lspEvent = Annotation.define<LspAnnotation>()
export const lspSemanticTokensEvent = lspEvent.of(LspAnnotation.SemanticTokens)
export const lspFormatCodeEvent = lspEvent.of(LspAnnotation.FormatCode)
export const lspDiagnosticsEvent = lspEvent.of(LspAnnotation.Diagnostics)

export interface LanguageServerOptions {
  // We assume this is the main project directory, we are currently working in.
  workspaceFolders: LSP.WorkspaceFolder[]
  documentUri: string
  allowHTMLContent: boolean
  client: LanguageServerClient
  processLspNotification?: (
    plugin: LanguageServerPlugin,
    notification: LSP.NotificationMessage
  ) => void

  changesDelay?: number

  doSemanticTokens?: boolean
  doFoldingRanges?: boolean
}

export class LanguageServerPlugin implements PluginValue {
  public client: LanguageServerClient
  private documentVersion: number
  private foldingRanges: LSP.FoldingRange[] | null = null

  private previousSemanticTokens: SemanticToken[] = []

  private allowHTMLContent: boolean = true
  private changesDelay: number = 600
  private processLspNotification?: (
    plugin: LanguageServerPlugin,
    notification: LSP.NotificationMessage
  ) => void

  private doSemanticTokens: boolean = false
  private doFoldingRanges: boolean = false

  // When a doc update needs to be sent to the server, this holds the
  // timeout handle for it. When null, the server has the up-to-date
  // document.
  private sendScheduled: number | null = null

  constructor(options: LanguageServerOptions, private view: EditorView) {
    this.client = options.client
    this.documentVersion = 0

    this.doSemanticTokens = options.doSemanticTokens ?? false
    this.doFoldingRanges = options.doFoldingRanges ?? false

    if (options.changesDelay) {
      this.changesDelay = options.changesDelay
    }

    if (options.allowHTMLContent !== undefined) {
      this.allowHTMLContent = options.allowHTMLContent
    }

    this.client.attachPlugin(this)

    this.processLspNotification = options.processLspNotification

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialize({
      documentText: this.getDocText(),
    })
  }

  private getDocPath(view = this.view) {
    return view.state.facet(docPathFacet)
  }

  private getDocText(view = this.view) {
    return view.state.doc.toString()
  }

  private getDocUri(view = this.view) {
    return URI.file(this.getDocPath(view)).toString()
  }

  private getLanguageId(view = this.view) {
    return view.state.facet(languageId)
  }

  update(viewUpdate: ViewUpdate) {
    if (viewUpdate.docChanged) {
      this.scheduleSendDoc()
    }
  }

  destroy() {
    this.client.detachPlugin(this)
  }

  async initialize({ documentText }: { documentText: string }) {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    if (this.client.initializePromise) {
      await this.client.initializePromise
    }

    this.client.textDocumentDidOpen({
      textDocument: {
        uri: this.getDocUri(),
        languageId: this.getLanguageId(),
        text: documentText,
        version: this.documentVersion,
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.requestSemanticTokens()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateFoldingRanges()
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

    this.ensureDocSent()
    const result = await this.client.textDocumentHover({
      textDocument: { uri: this.getDocUri() },
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
    dom.classList.add('hover-tooltip')
    dom.style.zIndex = '99999999'
    if (this.allowHTMLContent) dom.innerHTML = formatMarkdownContents(contents)
    else dom.textContent = formatMarkdownContents(contents)
    return { pos, end, create: (view) => ({ dom }), above: true }
  }

  scheduleSendDoc() {
    if (this.sendScheduled != null) window.clearTimeout(this.sendScheduled)
    this.sendScheduled = window.setTimeout(
      () => this.sendDoc(),
      this.changesDelay
    )
  }

  sendDoc() {
    if (this.sendScheduled != null) {
      window.clearTimeout(this.sendScheduled)
      this.sendScheduled = null
    }

    if (!this.client.ready) return

    try {
      // Update the state (not the editor) with the new code.
      this.client.textDocumentDidChange({
        textDocument: {
          uri: this.getDocUri(),
          version: this.documentVersion++,
        },
        contentChanges: [{ text: this.view.state.doc.toString() }],
      })

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.requestSemanticTokens()
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateFoldingRanges()
    } catch (e) {
      console.error(e)
    }
  }

  ensureDocSent() {
    if (this.sendScheduled != null) this.sendDoc()
  }

  async getFoldingRanges(): Promise<LSP.FoldingRange[] | null> {
    if (
      !this.doFoldingRanges ||
      !this.client.ready ||
      !this.client.getServerCapabilities().foldingRangeProvider
    )
      return null

    const result = await this.client.textDocumentFoldingRange({
      textDocument: { uri: this.getDocUri() },
    })

    return result || null
  }

  async updateFoldingRanges() {
    const foldingRanges = await this.getFoldingRanges()
    if (foldingRanges === null) return
    // Update the folding ranges.
    this.foldingRanges = foldingRanges
  }

  // In the future if codemirrors foldService accepts async folding ranges
  // then we will not have to store these and we can call getFoldingRanges
  // here.
  foldingRange(
    lineStart: number,
    lineEnd: number
  ): { from: number; to: number } | null {
    if (this.foldingRanges === null) {
      return null
    }

    for (let i = 0; i < this.foldingRanges.length; i++) {
      const { startLine, endLine } = this.foldingRanges[i]
      if (startLine === lineEnd) {
        const range = {
          // Set the fold start to the end of the first line
          // With this, the fold will not include the first line
          from: startLine,
          to: endLine,
        }

        return range
      }
    }

    return null
  }

  async requestFormatting() {
    if (
      !this.client.ready ||
      !this.client.getServerCapabilities().documentFormattingProvider
    )
      return null

    this.ensureDocSent()

    const result = await this.client.textDocumentFormatting({
      textDocument: { uri: this.getDocUri() },
      options: {
        tabSize: 2,
        insertSpaces: true,
        insertFinalNewline: true,
      },
    })

    if (!result || !result.length) return null

    this.view.dispatch({
      changes: result.map(({ range, newText }) => ({
        from: posToOffset(this.view.state.doc, range.start)!,
        to: posToOffset(this.view.state.doc, range.end)!,
        insert: newText,
      })),
      annotations: lspFormatCodeEvent,
    })
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

    this.ensureDocSent()

    const result = await this.client.textDocumentCompletion({
      textDocument: { uri: this.getDocUri() },
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
        const detailText = [
          deprecated ? 'Deprecated' : undefined,
          labelDetails ? labelDetails.detail : detail,
        ]
          // Don't let undefined appear.
          .filter(Boolean)
          .join(' ')
        const completion: Completion & {
          filterText: string
          sortText?: string
          apply: string
        } = {
          label,
          detail: detailText,
          apply: label,
          type: kind && CompletionItemKindMap[kind].toLowerCase(),
          sortText: sortText ?? label,
          filterText: filterText ?? label,
        }
        if (documentation) {
          completion.info = () => {
            const deprecatedHtml = deprecated
              ? '<p><strong>Deprecated</strong></p>'
              : ''
            const htmlString =
              deprecatedHtml + formatMarkdownContents(documentation)
            const htmlNode = document.createElement('div')
            htmlNode.style.display = 'contents'
            htmlNode.innerHTML = htmlString
            return { dom: htmlNode }
          }
        }

        if (insertText && insertTextFormat === 2) {
          return snippetCompletion(insertText, completion)
        }

        return completion
      }
    )

    return completeFromList(options)(context)
  }

  parseSemanticTokens(view: EditorView, data: number[]) {
    // decode the lsp semantic token types
    const tokens = []
    for (let i = 0; i < data.length; i += 5) {
      tokens.push({
        deltaLine: data[i],
        startChar: data[i + 1],
        length: data[i + 2],
        tokenType: data[i + 3],
        modifiers: data[i + 4],
      })
    }

    // convert the tokens into an array of {to, from, type} objects
    const tokenTypes =
      this.client.getServerCapabilities().semanticTokensProvider!.legend
        .tokenTypes
    const tokenModifiers =
      this.client.getServerCapabilities().semanticTokensProvider!.legend
        .tokenModifiers
    const tokenRanges: any = []
    let curLine = 0
    let prevStart = 0
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const tokenType = tokenTypes[token.tokenType]
      // get a list of modifiers
      const tokenModifier = []
      for (let j = 0; j < tokenModifiers.length; j++) {
        if (token.modifiers & (1 << j)) {
          tokenModifier.push(tokenModifiers[j])
        }
      }

      if (token.deltaLine !== 0) prevStart = 0

      const tokenRange = {
        from: posToOffset(view.state.doc, {
          line: curLine + token.deltaLine,
          character: prevStart + token.startChar,
        })!,
        to: posToOffset(view.state.doc, {
          line: curLine + token.deltaLine,
          character: prevStart + token.startChar + token.length,
        })!,
        type: tokenType,
        modifiers: tokenModifier,
      }
      tokenRanges.push(tokenRange)

      curLine += token.deltaLine
      prevStart += token.startChar
    }

    // sort by from
    tokenRanges.sort((a: any, b: any) => a.from - b.from)
    return tokenRanges
  }

  async requestSemanticTokens() {
    if (
      !this.doSemanticTokens ||
      !this.client.ready ||
      !this.client.getServerCapabilities().semanticTokensProvider
    ) {
      return null
    }

    const result = await this.client.textDocumentSemanticTokensFull({
      textDocument: { uri: this.getDocUri() },
    })
    if (!result) return null

    const { data } = result
    this.previousSemanticTokens = this.parseSemanticTokens(this.view, data)

    const effects: StateEffect<SemanticToken | Extension>[] =
      this.previousSemanticTokens.map((tokenRange: any) =>
        addToken.of(tokenRange)
      )

    this.view.dispatch({
      effects,

      annotations: [lspSemanticTokensEvent, Transaction.addToHistory.of(false)],
    })
  }

  async processNotification(notification: LSP.NotificationMessage) {
    try {
      switch (notification.method) {
        case 'textDocument/publishDiagnostics':
          if (notification === undefined) break
          if (notification.params === undefined) break
          if (!notification.params) break
          const params = notification.params as PublishDiagnosticsParams
          if (!params) break
          console.log(
            '[lsp] [window/publishDiagnostics]',
            this.client.getName(),
            params
          )
          // this is sometimes slower than our actual typing.
          this.processDiagnostics(params)
          break
        case 'window/logMessage':
          console.log(
            '[lsp] [window/logMessage]',
            this.client.getName(),
            notification.params
          )
          break
        case 'window/showMessage':
          console.log(
            '[lsp] [window/showMessage]',
            this.client.getName(),
            notification.params
          )
          break
      }
    } catch (error) {
      console.error(error)
    }

    // Send it to the plugin
    this.processLspNotification?.(this, notification)
  }

  processDiagnostics(params: PublishDiagnosticsParams) {
    if (params.uri !== this.getDocUri()) return

    // Commented to avoid the lint.  See TODO below.
    // const diagnostics =
    params.diagnostics
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

    /* This creates infighting with the others.
     * TODO: turn it back on when we have a better way to handle it.
     * this.view.dispatch({
      effects: [setDiagnosticsEffect.of(diagnostics)],
      annotations: [lspDiagnosticsEvent, Transaction.addToHistory.of(false)],
    })*/
  }
}

export class LanguageServerPluginSpec
  implements PluginSpec<LanguageServerPlugin>
{
  provide(plugin: ViewPlugin<LanguageServerPlugin>): Extension {
    return [
      lspAutocompleteExt(plugin),
      lspFormatExt(plugin),
      lspHoverExt(plugin),
      lspIndentExt(),
      lspSemanticTokensExt(),
      linter(null),
    ]
  }
}
