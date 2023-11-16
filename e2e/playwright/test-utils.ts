import { expect, Page } from '@playwright/test'
import { EngineCommand } from '../../src/lang/std/engineConnection'

async function waitForPageLoad(page: Page) {
  // wait for 'Loading KittyCAD Modeling App...' spinner
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="initial-load"]')
  )
  // wait for 'Loading stream...' spinner
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="loading-stream"]')
  )

  // wait for all spinners to be gone
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="loading"]')
  )

  await page.waitForFunction(() =>
    document.querySelector('[data-testid="start-sketch"]')
  )
}

async function removeCurrentCode(page: Page) {
  await page.click('.cm-content')
  await page.keyboard.down('Meta')
  await page.keyboard.press('a')
  await page.keyboard.up('Meta')
  await page.keyboard.press('Backspace')
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
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="debug-panel"]')
          ?.getAttribute('open') === ''
    )
  }
}

async function closeDebugPanel(page: Page) {
  const isOpen =
    (await page
      .locator('[data-testid="debug-panel"]')
      ?.getAttribute('open')) === ''
  if (isOpen) {
    await page.getByText('Debug').click()
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="debug-panel"]')
          ?.getAttribute('open') === null
    )
  }
}

export function getUtils(page: Page) {
  return {
    waitForPageLoad: () => waitForPageLoad(page),
    removeCurrentCode: () => removeCurrentCode(page),
    sendCustomCmd: (cmd: EngineCommand) => sendCustomCmd(page, cmd),
    clearCommandLogs: () => clearCommandLogs(page),
    expectCmdLog: (locatorStr: string) => expectCmdLog(page, locatorStr),
    waitForDefaultPlanesToBeVisible: () =>
      waitForDefaultPlanesToBeVisible(page),
    openDebugPanel: () => openDebugPanel(page),
    closeDebugPanel: () => closeDebugPanel(page),
    openAndClearDebugPanel: async () => {
      await openDebugPanel(page)
      return clearCommandLogs(page)
    },
    waitForCmdReceive: async (commandType: string) => {
      await page.waitForFunction(
        (commandType) =>
          document.querySelector(
            `[data-receive-command-type="${commandType}"]`
          ),
        commandType
      )
    },
  }
}
