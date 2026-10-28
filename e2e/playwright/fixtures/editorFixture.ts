import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import {
  checkIfPaneIsOpen,
  closePane,
  openPane,
  sansWhitespace,
} from '@e2e/playwright/test-utils'

interface EditorState {
  activeLines: Array<string>
  highlightedCode?: string
  diagnostics: Array<string>
}

export class EditorFixture {
  public page: Page

  private paneButtonTestId = 'code-pane-button'
  private diagnosticsTooltip!: Locator
  private diagnosticsGutterIcon!: Locator
  public codeContent!: Locator
  public activeLine!: Locator
  public lines!: Locator

  constructor(page: Page) {
    this.page = page
    this.codeContent = page.locator('.cm-content[data-language="kcl"]')
    this.diagnosticsTooltip = page.locator('.cm-tooltip-lint')
    this.diagnosticsGutterIcon = page.locator('.cm-lint-marker-error')
    this.activeLine = this.page.locator('.cm-activeLine')
    this.lines = this.page.locator('.cm-line')
  }

  private _expectEditorToContain =
    (not = false) =>
    async (
      code: string | RegExp,
      {
        shouldNormalise = false,
        timeout = 5_000,
      }: { shouldNormalise?: boolean; timeout?: number } = {}
    ) => {
      if (shouldNormalise && typeof code !== 'string') {
        throw new Error(
          'The `shouldNormalise` option does not work with a RegExp value for `code` argument'
        )
      }
      const normalise = (text: string) =>
        text.replaceAll(/\s+/g, shouldNormalise ? '' : ' ').trim()
      const expected = typeof code === 'string' ? normalise(code) : code
      // CodeMirror only mounts visible lines. Read the whole document without
      // changing the pane state or depending on the editor's height.
      const actual = expect.poll(
        async () => {
          const text = await this.getCurrentCode()
          return typeof expected === 'string' ? normalise(text) : text
        },
        { timeout }
      )
      const assertion = not ? actual.not : actual
      return typeof expected === 'string'
        ? assertion.toContain(expected)
        : assertion.toMatch(expected)
    }
  expectEditor = {
    toContain: this._expectEditorToContain(),
    not: { toContain: this._expectEditorToContain(true) },
    toBe: async (code: string) => {
      return expect.poll(this.getCurrentCode).toBe(code)
    },
  }
  getCurrentCode = async () =>
    this.page.evaluate(() => window.app.singletons.kclManager.code)
  snapshot = async (options?: { timeout?: number; name?: string }) => {
    const wasPaneOpen = await this.checkIfPaneIsOpen()
    if (!wasPaneOpen) {
      await this.openPane()
    }
    await this.scrollToBottom()
    try {
      // Use expect.poll to implement retry logic
      expect
        .poll(
          async () => {
            const code = await this.codeContent.textContent()
            return code || ''
          },
          { timeout: options?.timeout || 5000 }
        )
        .toMatchSnapshot(options?.name || 'editor-content')
    } finally {
      // Reset pane state if needed
      if (!wasPaneOpen) {
        await this.closePane()
      }
    }
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
    await this.openPane()
    await expect.poll(this._getActiveLines).toEqual(lines.map((l) => l.trim()))
  }
  /** assert all editor state EXCEPT the code content */
  expectState = async (expectedState: EditorState) => {
    await this.openPane()
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
      .toMatchObject({
        activeLines: expectedState.activeLines.map(sansWhitespace),
        ...(typeof expectedState.highlightedCode !== 'undefined'
          ? { highlightedCode: sansWhitespace(expectedState.highlightedCode) }
          : {}),
        diagnostics: expectedState.diagnostics.map(sansWhitespace),
      })
  }
  replaceCode = async (findCode: string, replaceCode: string) => {
    await this.openPane()
    let code = await this.getCurrentCode()
    if (!findCode) {
      code = replaceCode
    } else {
      code = code.replace(findCode, replaceCode)
    }
    await this.codeContent.fill(code)
  }
  replaceCodeByTyping = async (findCode: string, replaceCode: string) => {
    if (!(await this.checkIfPaneIsOpen())) {
      await this.openPane()
    }
    await this.page.evaluate(
      ({ findCode, replaceCode }) => {
        const editorView = window.app.singletons.kclManager.editorView
        const currentCode = editorView.state.doc.toString()
        const from = currentCode.indexOf(findCode)
        if (from === -1) {
          throw new Error(`Could not find code to replace: ${findCode}`)
        }
        editorView.dispatch({
          changes: { from, to: from + findCode.length, insert: replaceCode },
        })
      },
      { findCode, replaceCode }
    )
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
  async scrollToBottom() {
    let nextLineCount = await this.lines.count()
    let currLineCount: number
    do {
      currLineCount = nextLineCount
      await this.lines.last().scrollIntoViewIfNeeded()
      await this.page.waitForTimeout(50)
      nextLineCount = await this.lines.count()
    } while (nextLineCount !== currLineCount)
  }
  async scrollToText(text: string, placeCursor?: boolean) {
    if (!(await this.checkIfPaneIsOpen())) {
      await this.openPane()
    }
    await expect(this.codeContent).not.toBeEmpty()
    return this.page.evaluate(
      (args: { text: string; placeCursor?: boolean }) => {
        const editorView = window.app.singletons.kclManager.editorView
        const index = editorView.state.doc.toString().indexOf(args.text)
        editorView.focus()
        editorView.dispatch({
          ...(args.placeCursor
            ? { selection: window.EditorSelection.cursor(index) }
            : {}),
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
    await this.scrollToText(text)

    // Select the rendered text after scrolling it into CodeMirror's viewport.
    await this.codeContent.getByText(text).first().selectText()
  }
}
