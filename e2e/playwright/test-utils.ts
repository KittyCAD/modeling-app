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
      const fillInput = async (axis: 'x' | 'y' | 'z', value: number) => {
        await page.fill(`[data-testid="cam-${axis}-position"]`, String(value))
        await page.waitForTimeout(100)
      }

      await fillInput('x', xyz[0])
      await fillInput('y', xyz[1])
      await fillInput('z', xyz[2])
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

type TemplateOptions = Array<number | Array<number>>

type makeTemplateReturn = {
  regExp: RegExp
  genNext: (
    templateParts: TemplateStringsArray,
    ...options: TemplateOptions
  ) => makeTemplateReturn
}

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

const _makeTemplate = (
  templateParts: TemplateStringsArray,
  ...options: TemplateOptions
) => {
  const length = Math.max(...options.map((a) => (Array.isArray(a) ? a[0] : 0)))
  let reExpTemplate = ''
  for (let i = 0; i < length; i++) {
    const currentStr = templateParts.map((str, index) => {
      const currentOptions = options[index]
      return (
        escapeRegExp(str) +
        String(
          Array.isArray(currentOptions)
            ? currentOptions[i]
            : typeof currentOptions === 'number'
            ? currentOptions
            : ''
        )
      )
    })
    reExpTemplate += '|' + currentStr.join('')
  }
  return new RegExp(reExpTemplate)
}

/**
 * Tool for making templates to match code snippets in the editor with some fudge factor, as there's some level of undeterminism
 * usage is such
 * ```typescript
 * const result = makeTemplate`const myVar = aFunc(${[1, 2, 3]})`
 * await expect(page.locator('.cm-content')).toHaveText(result.regExp)
 * ```
 * Where the value 1, 2 or 3 are all valid and should make the test pass
 *
 * The function also has a `genNext` function that allows you to chain multiple templates together
 * ```typescript
 * const result2 = result.genNext`const myVar2 = aFunc(${[4, 5, 6]})`
 * ```
 */
export const makeTemplate: (
  templateParts: TemplateStringsArray,
  ...values: TemplateOptions
) => makeTemplateReturn = (templateParts, ...options) => {
  return {
    regExp: _makeTemplate(templateParts, ...options),
    genNext: (
      nextTemplateParts: TemplateStringsArray,
      ...nextOptions: TemplateOptions
    ) =>
      makeTemplate(
        [...templateParts, ...nextTemplateParts] as any as TemplateStringsArray,
        [...options, ...nextOptions] as any
      ),
  }
}
