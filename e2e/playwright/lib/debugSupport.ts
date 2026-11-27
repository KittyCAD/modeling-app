import type { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'
import { openPane } from '@e2e/playwright/lib/paneSupport'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { EngineCommand } from '@src/lang/std/artifactGraph'

export async function sendCustomCmd(page: Page, cmd: EngineCommand) {
  const json = JSON.stringify(cmd)
  await page.getByTestId('custom-cmd-input').fill(json)
  await expect(page.getByTestId('custom-cmd-input')).toHaveValue(json)
  await page.getByTestId('custom-cmd-send-button').scrollIntoViewIfNeeded()
  await page.getByTestId('custom-cmd-send-button').click()
}

export async function clearCommandLogs(page: Page) {
  await page.getByTestId('custom-cmd-input').fill('')
  await page.getByTestId('clear-commands').scrollIntoViewIfNeeded()
  await page.getByTestId('clear-commands').click()
}

export async function expectCmdLog(
  page: Page,
  locatorStr: string,
  timeout = 5000
) {
  await expect(page.locator(locatorStr).last()).toBeVisible({ timeout })
}

export async function openDebugPanel(page: Page) {
  await openPane(page, 'debug-pane-button')

  // Wait for the lazy pane contents rather than imposing a fixed delay.
  await expect(page.getByTestId('debug-panel')).toBeAttached()
}

export async function closeDebugPanel(page: Page) {
  const debugLocator = page.getByTestId('debug-pane-button')
  await expect(debugLocator).toBeVisible()
  const isOpen = (await debugLocator?.getAttribute('aria-pressed')) === 'true'
  if (isOpen) {
    await debugLocator.click()
    await expect(debugLocator).not.toHaveAttribute('aria-pressed', 'true')
  }
}

export async function waitForCmdReceive(page: Page, commandType: string) {
  return page
    .locator(`[data-receive-command-type="${commandType}"]`)
    .first()
    .waitFor()
}

export async function openAndClearDebugPanel(page: Page) {
  await openDebugPanel(page)
  return clearCommandLogs(page)
}

/**
 * A developer helper function to make playwright send all the console logs to stdout
 * Call this within your E2E test and pass in the page or the tronApp to get as many
 * logs piped to stdout for debugging
 */
export async function enableConsoleLogEverything({
  page,
  tronApp,
}: {
  page?: Page
  tronApp?: ElectronZoo
}) {
  page?.on('console', (msg) => {
    console.log(`[Page-log]: ${msg.text()}`)
  })

  tronApp?.electron.on('window', async (electronPage) => {
    electronPage.on('console', (msg) => {
      console.log(`[Renderer] ${msg.type()}: ${msg.text()}`)
    })
  })

  tronApp?.electron.on('console', (msg) => {
    console.log(`[Main] ${msg.type()}: ${msg.text()}`)
  })
}
