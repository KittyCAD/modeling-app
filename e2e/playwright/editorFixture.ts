import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

interface EditorState {
  activeLines: Array<string>
  highlightedCode: string
  diagnostics: Array<string>
}

function removeWhitespace(str: string) {
  return str.replace(/\s+/g, '').trim()
}
export class EditorFixture {
  public readonly page: Page

  private readonly diagnosticsTooltip: Locator
  private readonly diagnosticsGutterIcon: Locator
  private readonly codeContent: Locator
  private readonly activeLine: Locator

  constructor(page: Page) {
    this.page = page

    this.codeContent = page.locator('.cm-content')
    this.diagnosticsTooltip = page.locator('.cm-tooltip-lint')
    this.diagnosticsGutterIcon = page.locator('.cm-lint-marker-error')
    this.activeLine = this.page.locator('.cm-activeLine')
  }

  private _expectEditorToContain =
    (not = false) =>
    (
      code: string,
      {
        shouldNormalise = false,
        timeout = 5_000,
      }: { shouldNormalise?: boolean; timeout?: number } = {}
    ) => {
      if (!shouldNormalise) {
        const expectStart = expect(this.codeContent)
        if (not) {
          return expectStart.not.toContainText(code, { timeout })
        }
        return expectStart.toContainText(code, { timeout })
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
        return expectStart.not.toContain(normalisedCode)
      }
      return expectStart.toContain(normalisedCode)
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
    return [...new Set(diagnosticsContent)].map((d) => d.trim())
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
          activeLines: activeLines.map(removeWhitespace).filter(Boolean),
          highlightedCode: removeWhitespace(highlightedCode),
          diagnostics,
        }
        return state
      })
      .toEqual({
        activeLines: expectedState.activeLines.map(removeWhitespace),
        highlightedCode: removeWhitespace(expectedState.highlightedCode),
        diagnostics: expectedState.diagnostics.map(removeWhitespace),
      })
  }
}
