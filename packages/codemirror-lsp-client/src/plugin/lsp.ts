import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import { completeFromList, snippetCompletion } from '@codemirror/autocomplete'
import type { Action, Diagnostic } from '@codemirror/lint'
import { linter } from '@codemirror/lint'
import type { Extension, StateEffect } from '@codemirror/state'
import { Facet, Transaction } from '@codemirror/state'
import type {
  EditorView,
  PluginSpec,
  PluginValue,
  Tooltip,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import type * as LSP from 'vscode-languageserver-protocol'
import type {
  CompletionTriggerKind,
  PublishDiagnosticsParams,
} from 'vscode-languageserver-protocol'
import { DiagnosticSeverity } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'

import type { LanguageServerClient } from '../client'
import {
  lspFormatCodeEvent,
  lspSemanticTokensEvent,
  lspRenameEvent,
} from './annotation'
import lspAutocompleteExt, { CompletionItemKindMap } from './autocomplete'
import lspFormatExt from './format'
import lspHoverExt from './hover'
import lspIndentExt from './indent'
import type { SemanticToken } from './semantic-tokens'
import lspSemanticTokensExt, { addToken } from './semantic-tokens'
import {
  formatContents,
  offsetToPos,
  posToOffset,
  posToOffsetOrZero,
  showErrorMessage,
} from './util'
import { isArray } from '../lib/utils'
import lspGoToDefinitionExt from './go-to-definition'
import lspRenameExt from './rename'
import lspSignatureHelpExt from './signature-help'

const useLast = (values: readonly any[]) => values.reduce((_, v) => v, '')
export const docPathFacet = Facet.define<string, string>({
  combine: useLast,
})
export const languageId = Facet.define<string, string>({ combine: useLast })
export const workspaceFolders = Facet.define<
  LSP.WorkspaceFolder[],
  LSP.WorkspaceFolder[]
>({ combine: useLast })

const severityMap: Record<DiagnosticSeverity, Diagnostic['severity']> = {
  [DiagnosticSeverity.Error]: 'error',
  [DiagnosticSeverity.Warning]: 'warning',
  [DiagnosticSeverity.Information]: 'info',
  [DiagnosticSeverity.Hint]: 'info',
}

/**
 * Result of a definition lookup operation
 */
export interface DefinitionResult {
  /** URI of the target document containing the definition */
  uri: string
  /** Range in the document where the definition is located */
  range: LSP.Range
  /** Whether the definition is in a different file than the current document */
  isExternalDocument: boolean
}

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

  /** Callback triggered when a go-to-definition action is performed */
  onGoToDefinition?: (result: DefinitionResult) => void
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

  private onGoToDefinition: ((result: DefinitionResult) => void) | undefined

  constructor(
    options: LanguageServerOptions,
    private view: EditorView
  ) {
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

    this.onGoToDefinition = options.onGoToDefinition

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
    if (this.allowHTMLContent) dom.innerHTML = formatContents(contents)
    else dom.textContent = formatContents(contents)
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
      triggerCharacter?: string
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
            const htmlString = deprecatedHtml + formatContents(documentation)
            const htmlNode = document.createElement('div')
            htmlNode.style.display = 'contents'
            htmlNode.innerHTML = htmlString
            return { dom: htmlNode }
          }
        }

        if (insertText && insertTextFormat === 2) {
          // We end with ${} so you can jump to the end of the snippet.
          // After the last argument.
          // This is not standard from the lsp so we add it here.
          if (insertText.endsWith(')')) {
            // We have a function its safe to insert the ${} at the end.
            insertText = insertText + '${}'
          }
          return snippetCompletion(insertText, completion)
        }

        return completion
      }
    )

    return completeFromList(options)(context)
  }

  async requestDefinition(
    view: EditorView,
    { line, character }: { line: number; character: number }
  ) {
    if (
      !(
        this.client.ready &&
        this.client.getServerCapabilities().definitionProvider
      )
    ) {
      return
    }

    const result = await this.client.textDocumentDefinition({
      textDocument: { uri: this.getDocUri() },
      position: { line, character },
    })

    if (!result) return

    const locations = isArray(result) ? result : [result]
    if (locations.length === 0) return

    // For now just handle the first location
    const location = locations[0]
    if (!location) return
    const uri = 'uri' in location ? location.uri : location.targetUri
    const range = 'range' in location ? location.range : location.targetRange

    // Check if the definition is in a different document
    const isExternalDocument = uri !== this.getDocUri()

    // Create the definition result
    const definitionResult: DefinitionResult = {
      uri,
      range,
      isExternalDocument,
    }

    // If it's the same document, update the selection
    if (!isExternalDocument) {
      view.dispatch(
        view.state.update({
          selection: {
            anchor: posToOffsetOrZero(view.state.doc, range.start),
            head: posToOffset(view.state.doc, range.end),
          },
        })
      )
    }

    if (this.onGoToDefinition) {
      this.onGoToDefinition(definitionResult)
    }

    return definitionResult
  }

  async requestCodeActions(
    range: LSP.Range,
    diagnosticCodes: string[]
  ): Promise<(LSP.Command | LSP.CodeAction)[] | null> {
    if (
      !(
        this.client.ready &&
        this.client.getServerCapabilities().codeActionProvider
      )
    ) {
      return null
    }

    return await this.client.textDocumentCodeAction({
      textDocument: { uri: this.getDocUri() },
      range,
      context: {
        diagnostics: [
          {
            range,
            code: diagnosticCodes[0],
            source: this.getLanguageId(),
            message: '',
          },
        ],
      },
    })
  }

  async requestRename(
    view: EditorView,
    { line, character }: { line: number; character: number }
  ) {
    if (
      !(this.client.getServerCapabilities().renameProvider && this.client.ready)
    ) {
      showErrorMessage(view, 'Rename not supported by language server')
      return
    }

    try {
      // First check if rename is possible at this position
      const prepareResult = await this.client
        .textDocumentPrepareRename({
          textDocument: { uri: this.getDocUri() },
          position: { line, character },
        })
        .catch(() => {
          // In case prepareRename is not supported,
          // we fallback to the default implementation
          return this.prepareRenameFallback(view, {
            line,
            character,
          })
        })

      if (!prepareResult || 'defaultBehavior' in prepareResult) {
        showErrorMessage(view, 'Cannot rename this symbol')
        return
      }

      // Create popup input
      const popup = document.createElement('div')
      popup.className = 'cm-rename-popup'
      popup.style.cssText =
        'position: absolute; padding: 4px; background: white; border: 1px solid #ddd; box-shadow: 0 2px 8px rgba(0,0,0,.15); z-index: 99;'

      const input = document.createElement('input')
      input.type = 'text'
      input.style.cssText =
        'width: 200px; padding: 4px; border: 1px solid #ddd;'

      // Get current word as default value
      const range =
        'range' in prepareResult ? prepareResult.range : prepareResult
      const from = posToOffset(view.state.doc, range.start)
      if (from == null) {
        return
      }
      const to = posToOffset(view.state.doc, range.end)
      input.value = view.state.doc.sliceString(from, to)

      popup.appendChild(input)

      // Position the popup near the word
      const coords = view.coordsAtPos(from)
      if (!coords) return

      popup.style.left = `${coords.left}px`
      popup.style.top = `${coords.bottom + 5}px`

      // Handle input
      const handleRename = async () => {
        const newName = input.value.trim()
        if (!newName) {
          showErrorMessage(view, 'New name cannot be empty')
          popup.remove()
          return
        }

        if (newName === input.defaultValue) {
          popup.remove()
          return
        }

        try {
          const edit = await this.client.textDocumentRename({
            textDocument: { uri: this.getDocUri() },
            position: { line, character },
            newName,
          })

          await this.applyRenameEdit(view, edit)
        } catch (error) {
          showErrorMessage(
            view,
            `Rename failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        } finally {
          popup.remove()
        }
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          handleRename()
        } else if (e.key === 'Escape') {
          popup.remove()
        }
        e.stopPropagation() // Prevent editor handling
      })

      // Handle clicks outside
      const handleOutsideClick = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node)) {
          popup.remove()
          document.removeEventListener('mousedown', handleOutsideClick)
        }
      }
      document.addEventListener('mousedown', handleOutsideClick)

      // Add to DOM
      document.body.appendChild(popup)
      input.focus()
      input.select()
    } catch (error) {
      showErrorMessage(
        view,
        `Rename failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Request signature help from the language server
   * @param view The editor view
   * @param position The cursor position
   * @returns A tooltip with the signature help information or null if not available
   */
  public async requestSignatureHelp(
    view: EditorView,
    {
      line,
      character,
    }: {
      line: number
      character: number
    },
    triggerCharacter: string | undefined = undefined
  ): Promise<Tooltip | null> {
    // Check if signature help is enabled
    if (
      !(
        this.client.ready &&
        this.client.getServerCapabilities().signatureHelpProvider
      )
    ) {
      return null
    }

    try {
      // Request signature help
      const result = await this.client.textDocumentSignatureHelp({
        textDocument: { uri: this.getDocUri() },
        position: { line, character },
        context: {
          isRetrigger: false,
          triggerKind: 1, // Invoked
          triggerCharacter,
        },
      })

      if (!result?.signatures || result.signatures.length === 0) {
        return null
      }

      // Create the tooltip container
      const dom = this.createTooltipContainer()

      // Get active signature
      const activeSignatureIndex = result.activeSignature ?? 0
      const activeSignature =
        result.signatures[activeSignatureIndex] || result.signatures[0]

      if (!activeSignature) {
        return null
      }

      const activeParameterIndex =
        result.activeParameter ?? activeSignature.activeParameter ?? 0

      // Create and add signature display element
      const signatureElement = this.createSignatureElement(
        activeSignature,
        activeParameterIndex
      )
      dom.appendChild(signatureElement)

      // Add documentation if available
      if (activeSignature.documentation) {
        dom.appendChild(
          this.createDocumentationElement(activeSignature.documentation)
        )
      }

      // Add parameter documentation if available
      const activeParam = activeSignature.parameters?.[activeParameterIndex]

      if (activeParam?.documentation) {
        dom.appendChild(
          this.createParameterDocElement(activeParam.documentation)
        )
      }

      // Position tooltip at cursor
      let pos = posToOffset(view.state.doc, { line, character })
      if (pos === null || pos === undefined) return null

      return {
        pos,
        end: pos,
        create: (_view) => ({ dom }),
        above: true,
      }
    } catch (error) {
      console.error('Signature help error:', error)
      return null
    }
  }

  /**
   * Shows a signature help tooltip at the specified position
   */
  public async showSignatureHelpTooltip(
    view: EditorView,
    pos: number,
    triggerCharacter?: string
  ) {
    const tooltip = await this.requestSignatureHelp(
      view,
      offsetToPos(view.state.doc, pos),
      triggerCharacter
    )

    if (tooltip) {
      // Create and show the tooltip manually
      const { pos: tooltipPos, create } = tooltip
      const tooltipView = create(view)

      const tooltipElement = document.createElement('div')
      tooltipElement.className =
        'documentation hover-tooltip cm-tooltip cm-signature-tooltip'
      tooltipElement.style.position = 'absolute'
      tooltipElement.style.zIndex = '99999999'

      tooltipElement.appendChild(tooltipView.dom)

      // Position the tooltip
      const coords = view.coordsAtPos(tooltipPos)
      if (coords) {
        tooltipElement.style.left = `${coords.left}px`
        tooltipElement.style.top = `${coords.bottom + 5}px`

        // Add to DOM
        document.body.appendChild(tooltipElement)

        // Remove after a delay or on editor changes
        setTimeout(() => {
          tooltipElement.remove()
        }, 10000) // Show for 10 seconds

        // Also remove on any user input
        const removeTooltip = () => {
          tooltipElement.remove()
          view.dom.removeEventListener('keydown', removeTooltip)
          view.dom.removeEventListener('mousedown', removeTooltip)
        }

        view.dom.addEventListener('keydown', removeTooltip)
        view.dom.addEventListener('mousedown', removeTooltip)
      }
    }
  }

  /**
   * Creates the main tooltip container for signature help
   */
  private createTooltipContainer(): HTMLElement {
    const dom = document.createElement('div')
    dom.classList.add('cm-signature-help')
    return dom
  }

  /**
   * Creates the signature element with parameter highlighting
   */
  private createSignatureElement(
    signature: LSP.SignatureInformation,
    activeParameterIndex: number
  ): HTMLElement {
    const signatureElement = document.createElement('div')
    signatureElement.classList.add('cm-signature')
    signatureElement.style.cssText =
      'font-family: monospace; margin-bottom: 4px;'

    if (!signature.label || typeof signature.label !== 'string') {
      signatureElement.textContent = 'Signature information unavailable'
      return signatureElement
    }

    const signatureText = signature.label
    const parameters = signature.parameters || []

    // If there are no parameters or no active parameter, just show the signature text
    if (parameters.length === 0 || !parameters[activeParameterIndex]) {
      signatureElement.textContent = signatureText
      return signatureElement
    }

    // Handle parameter highlighting based on the parameter label type
    const paramLabel = parameters[activeParameterIndex].label

    if (typeof paramLabel === 'string') {
      // Simple string replacement
      if (this.allowHTMLContent) {
        signatureElement.innerHTML = signatureText.replace(
          paramLabel,
          `<strong class="cm-signature-active-param">${paramLabel}</strong>`
        )
      } else {
        signatureElement.textContent = signatureText.replace(
          paramLabel,
          `«${paramLabel}»`
        )
      }
    } else if (isArray(paramLabel) && paramLabel.length === 2) {
      // Handle array format [startIndex, endIndex]
      this.applyRangeHighlighting(
        signatureElement,
        signatureText,
        paramLabel[0],
        paramLabel[1]
      )
    } else {
      signatureElement.textContent = signatureText
    }

    return signatureElement
  }

  /**
   * Applies parameter highlighting using a range approach
   */
  private applyRangeHighlighting(
    element: HTMLElement,
    text: string,
    startIndex: number,
    endIndex: number
  ): void {
    // Clear any existing content
    element.textContent = ''

    // Split the text into three parts: before, parameter, after
    const beforeParam = text.substring(0, startIndex)
    const param = text.substring(startIndex, endIndex)
    const afterParam = text.substring(endIndex)

    // Add the parts to the element
    element.appendChild(document.createTextNode(beforeParam))

    const paramSpan = document.createElement('span')
    paramSpan.classList.add('cm-signature-active-param')
    paramSpan.style.cssText = 'font-weight: bold; text-decoration: underline;'
    paramSpan.textContent = param
    element.appendChild(paramSpan)

    element.appendChild(document.createTextNode(afterParam))
  }

  /**
   * Creates the documentation element for signatures
   */
  private createDocumentationElement(
    documentation: string | LSP.MarkupContent
  ): HTMLElement {
    const docsElement = document.createElement('div')
    docsElement.classList.add('cm-signature-docs')
    docsElement.style.cssText = 'margin-top: 4px; color: #666;'

    const formattedContent = formatContents(documentation)

    if (this.allowHTMLContent) {
      docsElement.innerHTML = formattedContent
    } else {
      docsElement.textContent = formattedContent
    }

    return docsElement
  }

  /**
   * Creates the parameter documentation element
   */
  private createParameterDocElement(
    documentation: string | LSP.MarkupContent
  ): HTMLElement {
    const paramDocsElement = document.createElement('div')
    paramDocsElement.classList.add('cm-parameter-docs')
    paramDocsElement.style.cssText =
      'margin-top: 4px; font-style: italic; border-top: 1px solid #eee; padding-top: 4px;'

    const formattedContent = formatContents(documentation)

    if (this.allowHTMLContent) {
      paramDocsElement.innerHTML = formattedContent
    } else {
      paramDocsElement.textContent = formattedContent
    }

    return paramDocsElement
  }

  /**
   * Fallback implementation of prepareRename.
   * We try to find the word at the cursor position and return the range of the word.
   */
  private prepareRenameFallback(
    view: EditorView,
    { line, character }: { line: number; character: number }
  ): LSP.PrepareRenameResult | null {
    const doc = view.state.doc
    const lineText = doc.line(line + 1).text
    const wordRegex = /\w+/g
    let match: RegExpExecArray | null
    let start = character
    let end = character
    // Find all word matches in the line
    // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
    while ((match = wordRegex.exec(lineText)) !== null) {
      const matchStart = match.index
      const matchEnd = match.index + match[0].length

      // Check if cursor position is within or at the boundaries of this word
      if (character >= matchStart && character <= matchEnd) {
        start = matchStart
        end = matchEnd
        break
      }
    }

    if (start === character && end === character) {
      return null // No word found at cursor position
    }

    return {
      range: {
        start: {
          line,
          character: start,
        },
        end: {
          line,
          character: end,
        },
      },
      placeholder: lineText.slice(start, end),
    }
  }

  /**
   * Apply workspace edit from rename operation
   * @param view The editor view
   * @param edit The workspace edit to apply
   * @returns True if changes were applied successfully
   */
  protected async applyRenameEdit(
    view: EditorView,
    edit: LSP.WorkspaceEdit | null
  ): Promise<boolean> {
    if (!edit) {
      showErrorMessage(view, 'No edit returned from language server')
      return false
    }

    const changesMap = edit.changes ?? {}
    const documentChanges = edit.documentChanges ?? []

    if (Object.keys(changesMap).length === 0 && documentChanges.length === 0) {
      showErrorMessage(view, 'No changes to apply')
      return false
    }

    // Handle documentChanges (preferred) if available
    if (documentChanges.length > 0) {
      for (const docChange of documentChanges) {
        if ('textDocument' in docChange) {
          // This is a TextDocumentEdit
          const uri = docChange.textDocument.uri

          if (uri !== this.getDocUri()) {
            showErrorMessage(view, 'Multi-file rename not supported yet')
            continue
          }

          // Sort edits in reverse order to avoid position shifts
          const sortedEdits = docChange.edits.sort((a, b) => {
            const posA = posToOffset(view.state.doc, a.range.start)
            const posB = posToOffset(view.state.doc, b.range.start)
            return (posB ?? 0) - (posA ?? 0)
          })

          // Create a single transaction with all changes
          const changes = sortedEdits.map((edit) => ({
            from: posToOffset(view.state.doc, edit.range.start) ?? 0,
            to: posToOffset(view.state.doc, edit.range.end) ?? 0,
            insert: edit.newText,
            annotations: [lspRenameEvent],
          }))

          view.dispatch(view.state.update({ changes }))
          return true
        }

        // This is a CreateFile, RenameFile, or DeleteFile operation
        showErrorMessage(
          view,
          'File creation, deletion, or renaming operations not supported yet'
        )
        return false
      }
    }
    // Fall back to changes if documentChanges is not available
    else if (Object.keys(changesMap).length > 0) {
      // Apply all changes
      for (const [uri, changes] of Object.entries(changesMap)) {
        if (uri !== this.getDocUri()) {
          showErrorMessage(view, 'Multi-file rename not supported yet')
          continue
        }

        // Sort changes in reverse order to avoid position shifts
        const sortedChanges = changes.sort((a, b) => {
          const posA = posToOffset(view.state.doc, a.range.start)
          const posB = posToOffset(view.state.doc, b.range.start)
          return (posB ?? 0) - (posA ?? 0)
        })

        // Create a single transaction with all changes
        const changeSpecs = sortedChanges.map((change) => ({
          from: posToOffset(view.state.doc, change.range.start) ?? 0,
          to: posToOffset(view.state.doc, change.range.end) ?? 0,
          insert: change.newText,
        }))

        view.dispatch(view.state.update({ changes: changeSpecs }))
        return true
      }
    }

    return false
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
          await this.processDiagnostics(params)
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

  async processDiagnostics(params: PublishDiagnosticsParams) {
    if (params.uri !== this.getDocUri()) return

    // Commented to avoid the lint.  See TODO below.
    const rawDiagnostics = params.diagnostics.map(
      async ({ range, message, severity, code }) => {
        const actions = await this.requestCodeActions(range, [code as string])

        const codemirrorActions = actions?.map(
          (action): Action => ({
            name:
              'command' in action && typeof action.command === 'object'
                ? action.command?.title || action.title
                : action.title,
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            apply: async () => {
              if ('edit' in action && action.edit?.changes) {
                const changes = action.edit.changes[this.getDocUri()]

                if (!changes) {
                  return
                }

                // Apply workspace edit
                for (const change of changes) {
                  this.view.dispatch(
                    this.view.state.update({
                      changes: {
                        from: posToOffsetOrZero(
                          this.view.state.doc,
                          change.range.start
                        ),
                        to: posToOffset(this.view.state.doc, change.range.end),
                        insert: change.newText,
                      },
                    })
                  )
                }
              }

              if ('command' in action && action.command) {
                // TODO: Implement command execution
                // Execute command if present
                console.warn(
                  '[codemirror-lsp-client/processDiagnostics] executing command:',
                  action.command
                )
              }
            },
          })
        )

        const diagnostic: Diagnostic = {
          from: posToOffsetOrZero(this.view.state.doc, range.start),
          to: posToOffsetOrZero(this.view.state.doc, range.end),
          severity: severityMap[severity ?? DiagnosticSeverity.Error],
          source: this.getLanguageId(),
          actions: codemirrorActions,
          message,
        }

        return diagnostic
      }
    )

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const diagnostics = (await Promise.all(rawDiagnostics))
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
      linter(null),
      lspAutocompleteExt(plugin),
      lspFormatExt(plugin),
      lspGoToDefinitionExt(plugin),
      lspHoverExt(plugin),
      lspIndentExt(),
      lspRenameExt(plugin),
      lspSemanticTokensExt(),
      lspSignatureHelpExt(plugin),
    ]
  }
}
