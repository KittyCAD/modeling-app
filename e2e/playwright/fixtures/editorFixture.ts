import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'
import { sansWhitespace } from '../test-utils'

interface EditorState {
  activeLines: Array<string>
  highlightedCode: string
  diagnostics: Array<string>
}

export class EditorFixture {
  public page: Page

  private diagnosticsTooltip!: Locator
  private diagnosticsGutterIcon!: Locator
  private codeContent!: Locator
  private activeLine!: Locator

  constructor(page: Page) {
    this.page = page
    this.reConstruct(page)
  }
  reConstruct = (page: Page) => {
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
}
