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
  await expect(page.locator(locatorStr).last()).toBeVisible()
}

async function waitForDefaultPlanesToBeVisible(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-receive-command-type="object_visible"]')
        .length >= 3
  )
}

async function openKclCodePanel(page: Page) {
  const paneLocator = page.getByRole('tab', { name: 'KCL Code', exact: false })
  const isOpen = (await paneLocator?.getAttribute('aria-selected')) === 'true'

  if (!isOpen) {
    await paneLocator.click()
    await paneLocator.and(page.locator('[aria-selected="true"]')).waitFor()
  }
}

async function closeKclCodePanel(page: Page) {
  const paneLocator = page.getByRole('tab', { name: 'KCL Code', exact: false })
  const isOpen = (await paneLocator?.getAttribute('aria-selected')) === 'true'
  if (isOpen) {
    await paneLocator.click()
    await paneLocator
      .and(page.locator(':not([aria-selected="true"])'))
      .waitFor()
  }
}

async function openDebugPanel(page: Page) {
  const debugLocator = page.getByRole('tab', { name: 'Debug', exact: false })
  const isOpen = (await debugLocator?.getAttribute('aria-selected')) === 'true'

  if (!isOpen) {
    await debugLocator.click()
    await debugLocator.and(page.locator('[aria-selected="true"]')).waitFor()
  }
}

async function closeDebugPanel(page: Page) {
  const debugLocator = page.getByRole('tab', { name: 'Debug', exact: false })
  const isOpen = (await debugLocator?.getAttribute('aria-selected')) === 'true'
  if (isOpen) {
    await debugLocator.click()
    await debugLocator
      .and(page.locator(':not([aria-selected="true"])'))
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
    updateCamPosition: async (xyz: [number, number, number]) => {
      const fillInput = async () => {
        await page.fill('[data-testid="cam-x-position"]', String(xyz[0]))
        await page.fill('[data-testid="cam-y-position"]', String(xyz[1]))
        await page.fill('[data-testid="cam-z-position"]', String(xyz[2]))
      }
      await fillInput()
      await page.waitForTimeout(100)
    },
    clearCommandLogs: () => clearCommandLogs(page),
    expectCmdLog: (locatorStr: string) => expectCmdLog(page, locatorStr),
    openKclCodePanel: () => openKclCodePanel(page),
    closeKclCodePanel: () => closeKclCodePanel(page),
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
