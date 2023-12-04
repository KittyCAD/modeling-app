import { expect, Page } from '@playwright/test'
import { EngineCommand } from '../../src/lang/std/engineConnection'
import fsp from 'fs/promises'
import pixelMatch from 'pixelmatch'
import { PNG } from 'pngjs'

async function waitForPageLoad(page: Page) {
  // wait for 'Loading stream...' spinner
  await page.getByTestId('loading-stream').waitFor()
  // wait for all spinners to be gone
  await page.getByTestId('loading').waitFor({ state: 'detached' })

  await page.getByTestId('start-sketch').waitFor()
}

async function removeCurrentCode(page: Page) {
  const hotkey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.click('.cm-content')
  await page.keyboard.down(hotkey)
  await page.keyboard.press('a')
  await page.keyboard.up(hotkey)
  await page.keyboard.press('Backspace')
  await expect(page.locator('.cm-content')).toHaveText('')
}

async function sendCustomCmd(page: Page, cmd: EngineCommand) {
  await page.fill('[data-testid="custom-cmd-input"]', JSON.stringify(cmd))
  await page.click('[data-testid="custom-cmd-send-button"]')
}

async function clearCommandLogs(page: Page) {
  await page.click('[data-testid="clear-commands"]')
}

async function expectCmdLog(page: Page, locatorStr: string) {
  await expect(page.locator(locatorStr)).toBeVisible()
}

async function waitForDefaultPlanesToBeVisible(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-receive-command-type="object_visible"]')
        .length >= 3
  )
}

async function openDebugPanel(page: Page) {
  const isOpen =
    (await page
      .locator('[data-testid="debug-panel"]')
      ?.getAttribute('open')) === ''

  if (!isOpen) {
    await page.getByText('Debug').click()
    await page.getByTestId('debug-panel').and(page.locator('[open]')).waitFor()
  }
}

async function closeDebugPanel(page: Page) {
  const isOpen =
    (await page.getByTestId('debug-panel')?.getAttribute('open')) === ''
  if (isOpen) {
    await page.getByText('Debug').click()
    await page
      .getByTestId('debug-panel')
      .and(page.locator(':not([open])'))
      .waitFor()
  }
}

async function waitForCmdReceive(page: Page, commandType: string) {
  return page
    .locator(`[data-receive-command-type="${commandType}"]`)
    .first()
    .waitFor()
}

export function getUtils(page: Page) {
  return {
    waitForAuthSkipAppStart: () => waitForPageLoad(page),
    removeCurrentCode: () => removeCurrentCode(page),
    sendCustomCmd: (cmd: EngineCommand) => sendCustomCmd(page, cmd),
    clearCommandLogs: () => clearCommandLogs(page),
    expectCmdLog: (locatorStr: string) => expectCmdLog(page, locatorStr),
    waitForDefaultPlanesVisibilityChange: () =>
      waitForDefaultPlanesToBeVisible(page),
    openDebugPanel: () => openDebugPanel(page),
    closeDebugPanel: () => closeDebugPanel(page),
    openAndClearDebugPanel: async () => {
      await openDebugPanel(page)
      return clearCommandLogs(page)
    },
    clearAndCloseDebugPanel: async () => {
      await clearCommandLogs(page)
      return closeDebugPanel(page)
    },
    waitForCmdReceive: (commandType: string) =>
      waitForCmdReceive(page, commandType),
    doAndWaitForCmd: async (
      fn: () => Promise<void>,
      commandType: string,
      endWithDebugPanelOpen = true
    ) => {
      await openDebugPanel(page)
      await clearCommandLogs(page)
      await closeDebugPanel(page)
      await fn()
      await openDebugPanel(page)
      await waitForCmdReceive(page, commandType)
      if (!endWithDebugPanelOpen) {
        await closeDebugPanel(page)
      }
    },
    doAndWaitForImageDiff: (fn: () => Promise<any>, diffCount = 200) =>
      new Promise(async (resolve) => {
        await page.screenshot({
          path: './e2e/playwright/temp1.png',
          fullPage: true,
        })
        await fn()
        const isImageDiff = async () => {
          await page.screenshot({
            path: './e2e/playwright/temp2.png',
            fullPage: true,
          })
          const screenshot1 = PNG.sync.read(
            await fsp.readFile('./e2e/playwright/temp1.png')
          )
          const screenshot2 = PNG.sync.read(
            await fsp.readFile('./e2e/playwright/temp2.png')
          )
          const actualDiffCount = pixelMatch(
            screenshot1.data,
            screenshot2.data,
            null,
            screenshot1.width,
            screenshot2.height
          )
          return actualDiffCount > diffCount
        }

        // run isImageDiff every 50ms until it returns true or 5 seconds have passed (100 times)
        let count = 0
        const interval = setInterval(async () => {
          count++
          if (await isImageDiff()) {
            clearInterval(interval)
            resolve(true)
          } else if (count > 100) {
            clearInterval(interval)
            resolve(false)
          }
        }, 50)
      }),
  }
}
