import { completeFromList, snippetCompletion } from '@codemirror/autocomplete'
import { setDiagnostics } from '@codemirror/lint'
import { Facet } from '@codemirror/state'
import { EditorView, Tooltip } from '@codemirror/view'
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
import {
  codeManager,
  editorManager,
  kclManager,
  sceneInfra,
} from 'lib/singletons'
import type { UnitLength } from 'wasm-lib/kcl/bindings/UnitLength'
import { UpdateUnitsResponse } from 'wasm-lib/kcl/bindings/UpdateUnitsResponse'
import { UpdateCanExecuteResponse } from 'wasm-lib/kcl/bindings/UpdateCanExecuteResponse'

const useLast = (values: readonly any[]) => values.reduce((_, v) => v, '')
export const documentUri = Facet.define<string, string>({ combine: useLast })
export const languageId = Facet.define<string, string>({ combine: useLast })
export const workspaceFolders = Facet.define<
  LSP.WorkspaceFolder[],
  LSP.WorkspaceFolder[]
>({ combine: useLast })

const CompletionItemKindMap = Object.fromEntries(
  Object.entries(CompletionItemKind).map(([key, value]) => [value, key])
) as Record<CompletionItemKind, string>

const changesDelay = 600
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const updateDelay = 100

export class LanguageServerPlugin implements PluginValue {
  public client: LanguageServerClient
  public documentUri: string
  public languageId: string
  public workspaceFolders: LSP.WorkspaceFolder[]
  private documentVersion: number
  private foldingRanges: LSP.FoldingRange[] | null = null
  private viewUpdate: ViewUpdate | null = null
  private _defferer = deferExecution((code: string) => {
    try {
      // Update the state (not the editor) with the new code.
      this.client.textDocumentDidChange({
        textDocument: {
          uri: this.documentUri,
          version: this.documentVersion++,
        },
        contentChanges: [{ text: code }],
      })

      if (this.viewUpdate) {
        editorManager.handleOnViewUpdate(this.viewUpdate)
        setTimeout(() => sceneInfra.modelingSend({ type: 'Rejig sketch' }))
      }
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
    this.documentUri = this.view.state.facet(documentUri)
    this.languageId = this.view.state.facet(languageId)
    this.workspaceFolders = this.view.state.facet(workspaceFolders)
    this.documentVersion = 0

    this.client.attachPlugin(this)

    this.initialize({
      documentText: this.view.state.doc.toString(),
    })
  }

  update(viewUpdate: ViewUpdate) {
    this.viewUpdate = viewUpdate
    if (!viewUpdate.docChanged) {
      // debounce the view update.
      // otherwise it is laggy for typing.
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }

      debounceTimer = setTimeout(() => {
        editorManager.handleOnViewUpdate(viewUpdate)
      }, updateDelay)
      return
    }

    const newCode = this.view.state.doc.toString()

    codeManager.code = newCode
    codeManager.writeToFile()
    kclManager.executeCode()

    this.sendChange({
      documentText: newCode,
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

    this._defferer(documentText)
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

  async getFoldingRanges(): Promise<LSP.FoldingRange[] | null> {
    if (
      !this.client.ready ||
      !this.client.getServerCapabilities().foldingRangeProvider
    )
      return null
    const result = await this.client.textDocumentFoldingRange({
      textDocument: { uri: this.documentUri },
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
        uri: this.documentUri,
      },
      text: this.view.state.doc.toString(),
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
    console.log('[lsp] kcl: updated canExecute', canExecute, response)
    return response
  }

  async requestFormatting() {
    if (
      !this.client.ready ||
      !this.client.getServerCapabilities().documentFormattingProvider
    )
      return null

    this.sendChange({
      documentText: this.view.state.doc.toString(),
    })

    const result = await this.client.textDocumentFormatting({
      textDocument: { uri: this.documentUri },
      options: {
        tabSize: 2,
        insertSpaces: true,
        insertFinalNewline: true,
      },
    })

    if (!result) return null

    for (let i = 0; i < result.length; i++) {
      const { range, newText } = result[i]
      this.view.dispatch({
        changes: [
          {
            from: posToOffset(this.view.state.doc, range.start)!,
            to: posToOffset(this.view.state.doc, range.end)!,
            insert: newText,
          },
        ],
      })
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

        if (insertText && insertTextFormat === 2) {
          return snippetCompletion(insertText, completion)
        }

        return completion
      }
    )

    return completeFromList(options)(context)
  }

  async processNotification(notification: LSP.NotificationMessage) {
    try {
      switch (notification.method) {
        case 'textDocument/publishDiagnostics':
          //const params = notification.params as PublishDiagnosticsParams
          // this is sometimes slower than our actual typing.
          //this.processDiagnostics(params)
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
          kclManager.programMemory = updatedMemory
          break
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
