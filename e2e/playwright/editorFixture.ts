import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

export class EditorFixture {
  public readonly page: Page

  private readonly diagnosticsTooltip: Locator
  private readonly diagnosticsGutterIcon: Locator
  private readonly codeContent: Locator

  constructor(page: Page) {
    this.page = page

    this.codeContent = page.locator('.cm-content')
    this.diagnosticsTooltip = page.locator('.cm-tooltip-lint')
    this.diagnosticsGutterIcon = page.locator('.cm-lint-marker-error')
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
  expectDiagnosticsToBe = async (expected: Array<string>) =>
    await expect
      .poll(async () => {
        const result = await this._serialiseDiagnostics()
        return result
      })
      .toEqual(expected.map((e) => e.trim()))
}
