import { openPane } from '@e2e/playwright/lib/paneSupport'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const toNormalizedCode = (text: string) => {
  return text.replace(/\s+/g, '')
}

export const editorSelector = '[role="textbox"][data-language="kcl"]'

export async function removeCurrentCode(page: Page) {
  // First, hover the element in case the current mouse position is in the way
  await page.mouse.move(0, 0)
  await page.locator('.cm-content').click({ delay: 50 })
  await page.keyboard.down('ControlOrMeta')
  await page.keyboard.press('a')
  await page.keyboard.up('ControlOrMeta')
  await page.keyboard.press('Backspace')
  await expect(page.locator('.cm-content')).toHaveText('')
}

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

export async function closeKclCodePanel(page: Page) {
  const paneLocator = page.getByTestId('code-pane-button')
  const ariaSelected = await paneLocator?.getAttribute('aria-pressed')
  const isOpen = ariaSelected === 'true'

  if (isOpen) {
    await paneLocator.click()
    await expect(paneLocator).not.toHaveAttribute('aria-pressed', 'true')
  }
}

export async function pollEditorLinesSelectedLength(page: Page, lines: number) {
  return expect
    .poll(async () => {
      const lines = await page.locator('.cm-activeLine').all()
      return lines.length
    })
    .toBe(lines)
}
