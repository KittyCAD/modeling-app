import {
  completeFromList,
  hasNextSnippetField,
  pickedCompletion,
  snippetCompletion,
} from '@codemirror/autocomplete'
import {
  Facet,
  StateEffect,
  StateField,
  Extension,
  Annotation,
  Transaction,
} from '@codemirror/state'
import {
  EditorView,
  Tooltip,
  Decoration,
  DecorationSet,
} from '@codemirror/view'
import { URI } from 'vscode-uri'
import {
  DiagnosticSeverity,
  CompletionItemKind,
  CompletionTriggerKind,
} from 'vscode-languageserver-protocol'

import { deferExecution } from 'lib/utils'
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import type { ViewUpdate, PluginValue } from '@codemirror/view'
import type * as LSP from 'vscode-languageserver-protocol'
import { LanguageServerClient } from 'editor/plugins/lsp'
import { Marked } from '@ts-stack/markdown'
import { posToOffset } from 'editor/plugins/lsp/util'
import { Program, ProgramMemory } from 'lang/wasm'
import { codeManager, editorManager } from 'lib/singletons'
import type { UnitLength } from 'wasm-lib/kcl/bindings/UnitLength'
import { UpdateUnitsResponse } from 'wasm-lib/kcl/bindings/UpdateUnitsResponse'
import { UpdateCanExecuteResponse } from 'wasm-lib/kcl/bindings/UpdateCanExecuteResponse'
import { copilotPluginEvent } from './copilot'
import { codeManagerUpdateEvent } from 'lang/codeManager'
import {
  modelingMachineEvent,
  updateOutsideEditorEvent,
  setDiagnosticsEvent,
} from 'editor/manager'
import { SemanticToken, getTag } from 'editor/plugins/lsp/semantic_token'
import { highlightingFor } from '@codemirror/language'

const useLast = (values: readonly any[]) => values.reduce((_, v) => v, '')
export const docPathFacet = Facet.define<string, string>({
  combine: useLast,
})
export const languageId = Facet.define<string, string>({ combine: useLast })
export const workspaceFolders = Facet.define<
  LSP.WorkspaceFolder[],
  LSP.WorkspaceFolder[]
>({ combine: useLast })

enum LspAnnotation {
  SemanticTokens = 'semantic-tokens',
}

const lspEvent = Annotation.define<LspAnnotation>()
export const lspSemanticTokensEvent = lspEvent.of(LspAnnotation.SemanticTokens)

const CompletionItemKindMap = Object.fromEntries(
  Object.entries(CompletionItemKind).map(([key, value]) => [value, key])
) as Record<CompletionItemKind, string>

const changesDelay = 600

const addToken = StateEffect.define<SemanticToken>({
  map: (token: SemanticToken, change) => ({
    ...token,
    from: change.mapPos(token.from),
    to: change.mapPos(token.to),
  }),
})

export const semanticTokenField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(highlights, tr) {
    // Nothing can come before this line, this is very important!
    // It makes sure the highlights are updated correctly for the changes.
    highlights = highlights.map(tr.changes)

    const isSemanticTokensEvent = tr.annotation(lspSemanticTokensEvent.type)
    if (!isSemanticTokensEvent) {
      return highlights
    }

    console.log('Updating semantic tokens')

    // Check if any of the changes are addToken
    const hasAddToken = tr.effects.some((e) => e.is(addToken))
    if (hasAddToken) {
      highlights = highlights.update({
        filter: (from, to) => false,
      })
    }

    for (const e of tr.effects)
      if (e.is(addToken)) {
        const tag = getTag(e.value)
        const className = tag
          ? highlightingFor(tr.startState, [tag])
          : undefined

        if (e.value.from < e.value.to && tag) {
          if (className) {
            highlights = highlights.update({
              add: [
                Decoration.mark({ class: className }).range(
                  e.value.from,
                  e.value.to
                ),
              ],
            })
          }
        }
      }
    return highlights
  },
  provide: (f) => EditorView.decorations.from(f),
})

export enum TransactionAnnotation {
  Diagnostics = 'diagnostics',
  Remote = 'remote',
  UserSelect = 'user.select',
  UserInput = 'user.input',
  UserMove = 'user.move',
  UserDelete = 'user.delete',
  UserUndo = 'user.undo',
  UserRedo = 'user.redo',

  Copoilot = 'copilot',
  OutsideEditor = 'outsideEditor',
  CodeManager = 'codeManager',
  ModelingMachine = 'modelingMachineEvent',
  LspSemanticTokens = 'lspSemanticTokensEvent',

  PickedCompletion = 'pickedCompletion',
}

export interface TransactionInfo {
  annotations: TransactionAnnotation[]
  time: number | null
  docChanged: boolean
  addToHistory: boolean
  inSnippet: boolean
}

export const updateInfo = (update: ViewUpdate): TransactionInfo[] => {
  let transactionInfos: TransactionInfo[] = []

  for (const tr of update.transactions) {
    let annotations: TransactionAnnotation[] = []

    if (tr.isUserEvent('select')) {
      annotations.push(TransactionAnnotation.UserSelect)
    }

    if (tr.isUserEvent('input')) {
      annotations.push(TransactionAnnotation.UserInput)
    }
    if (tr.isUserEvent('delete')) {
      annotations.push(TransactionAnnotation.UserDelete)
    }
    if (tr.isUserEvent('undo')) {
      annotations.push(TransactionAnnotation.UserUndo)
    }
    if (tr.isUserEvent('redo')) {
      annotations.push(TransactionAnnotation.UserRedo)
    }
    if (tr.isUserEvent('move')) {
      annotations.push(TransactionAnnotation.UserMove)
    }

    if (tr.annotation(pickedCompletion) !== undefined) {
      annotations.push(TransactionAnnotation.PickedCompletion)
    }

    if (tr.annotation(copilotPluginEvent.type) !== undefined) {
      annotations.push(TransactionAnnotation.Copoilot)
    }

    if (tr.annotation(updateOutsideEditorEvent.type) !== undefined) {
      annotations.push(TransactionAnnotation.OutsideEditor)
    }

    if (tr.annotation(codeManagerUpdateEvent.type) !== undefined) {
      annotations.push(TransactionAnnotation.CodeManager)
    }

    if (tr.annotation(modelingMachineEvent.type) !== undefined) {
      annotations.push(TransactionAnnotation.ModelingMachine)
    }

    if (tr.annotation(lspSemanticTokensEvent.type) !== undefined) {
      annotations.push(TransactionAnnotation.LspSemanticTokens)
    }

    if (tr.annotation(setDiagnosticsEvent.type) !== undefined) {
      annotations.push(TransactionAnnotation.Diagnostics)
    }

    if (tr.annotation(Transaction.remote) !== undefined) {
      annotations.push(TransactionAnnotation.Remote)
    }

    transactionInfos.push({
      annotations,
      time: tr.annotation(Transaction.time) || null,
      docChanged: tr.docChanged,
      addToHistory: tr.annotation(Transaction.addToHistory) || false,
      inSnippet: hasNextSnippetField(update.state),
    })
  }

  return transactionInfos
}

export interface RelevantUpdate {
  overall: boolean
  userSelect: boolean
  time: number | null
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

export class LanguageServerPlugin implements PluginValue {
  public client: LanguageServerClient
  private documentVersion: number
  private foldingRanges: LSP.FoldingRange[] | null = null

  private previousSemanticTokens: SemanticToken[] = []

  private _defferer = deferExecution((code: string) => {
    try {
      // Update the state (not the editor) with the new code.
      this.client.textDocumentDidChange({
        textDocument: {
          uri: this.getDocUri(),
          version: this.documentVersion++,
        },
        contentChanges: [{ text: code }],
      })

      this.requestSemanticTokens(this.view)
    } catch (e) {
      console.error(e)
    }
  }, changesDelay)

  constructor(
    client: LanguageServerClient,
    private view: EditorView,
    private allowHTMLContent: boolean
  ) {
    this.client = client
    this.documentVersion = 0

    this.client.attachPlugin(this)

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
    const isRelevant = relevantUpdate(viewUpdate)
    if (!isRelevant.overall) {
      return
    }

    // If the doc didn't change we can return early.
    if (!viewUpdate.docChanged) {
      return
    }

    this.sendChange({
      documentText: viewUpdate.state.doc.toString(),
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
        uri: this.getDocUri(),
        languageId: this.getLanguageId(),
        text: documentText,
        version: this.documentVersion,
      },
    })

    this.requestSemanticTokens(this.view)
  }

  async sendChange({ documentText }: { documentText: string }) {
    if (!this.client.ready) return

    this._defferer(documentText)
  }

  requestDiagnostics(view: EditorView) {
    this.sendChange({ documentText: this.getDocText() })
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

    this.sendChange({ documentText: this.getDocText() })
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
    if (this.allowHTMLContent) dom.innerHTML = formatContents(contents)
    else dom.textContent = formatContents(contents)
    return { pos, end, create: (view) => ({ dom }), above: true }
  }

  async getFoldingRanges(): Promise<LSP.FoldingRange[] | null> {
    if (
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

  async updateUnits(units: UnitLength): Promise<UpdateUnitsResponse | null> {
    if (this.client.name !== 'kcl') return null
    if (!this.client.ready) return null

    return await this.client.updateUnits({
      textDocument: {
        uri: this.getDocUri(),
      },
      text: this.getDocText(),
      units,
    })
  }
  async updateCanExecute(
    canExecute: boolean
  ): Promise<UpdateCanExecuteResponse | null> {
    if (this.client.name !== 'kcl') return null
    if (!this.client.ready) return null

    let response = await this.client.updateCanExecute({
      canExecute,
    })

    if (!canExecute && response.isExecuting) {
      // We want to wait until the server is not busy before we reply to the
      // caller.
      while (response.isExecuting) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        response = await this.client.updateCanExecute({
          canExecute,
        })
      }
    }
    return response
  }

  async requestFormatting() {
    if (
      !this.client.ready ||
      !this.client.getServerCapabilities().documentFormattingProvider
    )
      return null

    this.client.textDocumentDidChange({
      textDocument: {
        uri: this.getDocUri(),
        version: this.documentVersion++,
      },
      contentChanges: [{ text: this.getDocText() }],
    })

    const result = await this.client.textDocumentFormatting({
      textDocument: { uri: this.getDocUri() },
      options: {
        tabSize: 2,
        insertSpaces: true,
        insertFinalNewline: true,
      },
    })

    if (!result) return null

    for (let i = 0; i < result.length; i++) {
      const { newText } = result[i]
      codeManager.updateCodeStateEditor(newText)
    }
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

  async requestSemanticTokens(view: EditorView) {
    if (
      !this.client.ready ||
      !this.client.getServerCapabilities().semanticTokensProvider
    ) {
      return null
    }
    console.log('Requesting semantic tokens')

    const result = await this.client.textDocumentSemanticTokensFull({
      textDocument: { uri: this.getDocUri() },
    })
    if (!result) return null

    const { data } = result
    this.previousSemanticTokens = this.parseSemanticTokens(view, data)

    const effects: StateEffect<SemanticToken | Extension>[] =
      this.previousSemanticTokens.map((tokenRange: any) =>
        addToken.of(tokenRange)
      )

    view.dispatch({
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
        case 'kcl/astUpdated':
          // The server has updated the AST, we should update elsewhere.
          let updatedAst = notification.params as Program
          console.log('[lsp]: Updated AST', updatedAst)

          // Update the folding ranges, since the AST has changed.
          // This is a hack since codemirror does not support async foldService.
          // When they do we can delete this.
          this.updateFoldingRanges()
          break
        case 'kcl/memoryUpdated':
          // The server has updated the memory, we should update elsewhere.
          let updatedMemory = notification.params as ProgramMemory
          console.log('[lsp]: Updated Memory', updatedMemory)
          break
      }
    } catch (error) {
      console.error(error)
    }
  }

  processDiagnostics(params: PublishDiagnosticsParams) {
    if (params.uri !== this.getDocUri()) return

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

    editorManager.addDiagnostics(diagnostics)
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
