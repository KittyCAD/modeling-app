import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'
import {
  closePane,
  checkIfPaneIsOpen,
  openPane,
  sansWhitespace,
} from '../test-utils'

interface EditorState {
  activeLines: Array<string>
  highlightedCode: string
  diagnostics: Array<string>
}

export class EditorFixture {
  public page: Page

  private paneButtonTestId = 'code-pane-button'
  private diagnosticsTooltip!: Locator
  private diagnosticsGutterIcon!: Locator
  private codeContent!: Locator
  public activeLine!: Locator

  constructor(page: Page) {
    this.page = page
    this.reConstruct(page)
  }
  reConstruct = (page: Page) => {
    this.page = page

    this.codeContent = page.locator('.cm-content[data-language="kcl"]')
    this.diagnosticsTooltip = page.locator('.cm-tooltip-lint')
    this.diagnosticsGutterIcon = page.locator('.cm-lint-marker-error')
    this.activeLine = this.page.locator('.cm-activeLine')
  }

  private _expectEditorToContain =
    (not = false) =>
    async (
      code: string,
      {
        shouldNormalise = false,
        timeout = 5_000,
      }: { shouldNormalise?: boolean; timeout?: number } = {}
    ) => {
      const wasPaneOpen = await this.checkIfPaneIsOpen()
      if (!wasPaneOpen) {
        await this.openPane()
      }
      const resetPane = async () => {
        if (!wasPaneOpen) {
          await this.closePane()
        }
      }
      if (!shouldNormalise) {
        const expectStart = expect.poll(() => this.codeContent.textContent())
        if (not) {
          const result = await expectStart.not.toContain(code)
          await resetPane()
          return result
        }
        const result = await expectStart.toContain(code)
        await resetPane()
        return result
      }
      const normalisedCode = code.replaceAll(/\s+/g, '').trim()
      const expectStart = expect.poll(
        async () => {
          const editorText = await this.codeContent.textContent()
          return editorText?.replaceAll(/\s+/g, '').trim()
        },
        {
          timeout,
        }
      )
      if (not) {
        const result = await expectStart.not.toContain(normalisedCode)
        await resetPane()
        return result
      }
      const result = await expectStart.toContain(normalisedCode)
      await resetPane()
      return result
    }
  expectEditor = {
    toContain: this._expectEditorToContain(),
    not: { toContain: this._expectEditorToContain(true) },
  }
  private _serialiseDiagnostics = async (): Promise<Array<string>> => {
    const diagnostics = await this.diagnosticsGutterIcon.all()
    const diagnosticsContent: string[] = []
    for (const diag of diagnostics) {
      await diag.hover()
      const content = await this.diagnosticsTooltip.allTextContents()
      diagnosticsContent.push(content.join(''))
    }
    return [...new Set(diagnosticsContent)].map((d) => sansWhitespace(d))
  }

  private _getHighlightedCode = async () => {
    const texts = (
      await this.page.getByTestId('hover-highlight').allInnerTexts()
    ).map((s) => s.replace(/\s+/g, '').trim())
    return texts.join('')
  }
  private _getActiveLines = async () =>
    (await this.activeLine.allInnerTexts()).map((l) => l.trim())
  expectActiveLinesToBe = async (lines: Array<string>) => {
    await expect.poll(this._getActiveLines).toEqual(lines.map((l) => l.trim()))
  }
  /** assert all editor state EXCEPT the code content */
  expectState = async (expectedState: EditorState) => {
    await expect
      .poll(async () => {
        const [activeLines, highlightedCode, diagnostics] = await Promise.all([
          this._getActiveLines(),
          this._getHighlightedCode(),
          this._serialiseDiagnostics(),
        ])
        const state: EditorState = {
          activeLines: activeLines.map(sansWhitespace).filter(Boolean),
          highlightedCode: sansWhitespace(highlightedCode),
          diagnostics,
        }
        return state
      })
      .toEqual({
        activeLines: expectedState.activeLines.map(sansWhitespace),
        highlightedCode: sansWhitespace(expectedState.highlightedCode),
        diagnostics: expectedState.diagnostics.map(sansWhitespace),
      })
  }
  replaceCode = async (findCode: string, replaceCode: string) => {
    const lines = await this.page.locator('.cm-line').all()
    let code = (await Promise.all(lines.map((c) => c.textContent()))).join('\n')
    if (!lines) return
    code = code.replace(findCode, replaceCode)
    await this.codeContent.fill(code)
  }
  checkIfPaneIsOpen() {
    return checkIfPaneIsOpen(this.page, this.paneButtonTestId)
  }
  closePane() {
    return closePane(this.page, this.paneButtonTestId)
  }
  openPane() {
    return openPane(this.page, this.paneButtonTestId)
  }
  scrollToText(text: string, placeCursor?: boolean) {
    return this.page.evaluate(
      (args: { text: string; placeCursor?: boolean }) => {
        // error TS2339: Property 'docView' does not exist on type 'EditorView'.
        // Except it does so :shrug:
        // @ts-ignore
        let index = window.editorManager._editorView?.docView.view.state.doc
          .toString()
          .indexOf(args.text)
        window.editorManager._editorView?.focus()
        window.editorManager._editorView?.dispatch({
          selection: window.EditorSelection.create([
            window.EditorSelection.cursor(index),
          ]),
          effects: [
            window.EditorView.scrollIntoView(
              window.EditorSelection.range(index, index + 1)
            ),
          ],
        })
      },
      { text, placeCursor }
    )
  }
  async selectText(text: string) {
    // First make sure the code pane is open
    const wasPaneOpen = await this.checkIfPaneIsOpen()
    if (!wasPaneOpen) {
      await this.openPane()
    }

    // Use Playwright's built-in text selection on the code content
    // it seems to only select whole divs, which works out to align with syntax highlighting
    // for code mirror, so you can probably select "sketch002 = startSketchOn('XZ')"
    // but less so for exactly "sketch002 = startS"
    await this.codeContent.getByText(text).first().selectText()

    // Reset pane state if needed
    if (!wasPaneOpen) {
      await this.closePane()
    }
  }
}
