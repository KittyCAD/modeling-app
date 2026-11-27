import { openPane } from '@e2e/playwright/lib/paneSupport'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const toNormalizedCode = (text: string) => {
  return text.replace(/\s+/g, '')
}

export const editorSelector = '[role="textbox"][data-language="kcl"]'

export async function openKclCodePanel(page: Page) {
  await openPane(page, 'code-pane-button')

  // Code Mirror lazy loads text! Wowza! Let's force-load the text for tests.
  await page.evaluate(() => {
    const { kclManager } = window.app.singletons
    kclManager.editorView.dispatch({
      selection: {
        anchor: kclManager.editorView.state.doc.length,
      },
      scrollIntoView: true,
    })
  })
}

export async function pollEditorLinesSelectedLength(page: Page, lines: number) {
  return expect
    .poll(async () => {
      const lines = await page.locator('.cm-activeLine').all()
      return lines.length
    })
    .toBe(lines)
}
