import { test, expect, Page, Download } from '@playwright/test'
import { EngineCommand } from '../../src/lang/std/engineConnection'
import os from 'os'
import fsp from 'fs/promises'
import pixelMatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { Protocol } from 'playwright-core/types/protocol'
import type { Models } from '@kittycad/lib'
import { APP_NAME } from 'lib/constants'

type TestColor = [number, number, number]
export const TEST_COLORS = {
  WHITE: [249, 249, 249] as TestColor,
  YELLOW: [255, 255, 0] as TestColor,
  BLUE: [0, 0, 255] as TestColor,
} as const

async function waitForPageLoad(page: Page) {
  // wait for 'Loading stream...' spinner
  await page.getByTestId('loading-stream').waitFor()
  // wait for all spinners to be gone
  await page
    .getByTestId('loading')
    .waitFor({ state: 'detached', timeout: 20_000 })

  await page.getByTestId('start-sketch').waitFor()
}

async function removeCurrentCode(page: Page) {
  const hotkey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.locator('.cm-content').click()
  await page.keyboard.down(hotkey)
  await page.keyboard.press('a')
  await page.keyboard.up(hotkey)
  await page.keyboard.press('Backspace')
  await expect(page.locator('.cm-content')).toHaveText('')
}

async function sendCustomCmd(page: Page, cmd: EngineCommand) {
  await page.getByTestId('custom-cmd-input').fill(JSON.stringify(cmd))
  await page.getByTestId('custom-cmd-send-button').click()
}

async function clearCommandLogs(page: Page) {
  await page.getByTestId('clear-commands').click()
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

export const wiggleMove = async (
  page: any,
  x: number,
  y: number,
  steps: number,
  dist: number,
  ang: number,
  amplitude: number,
  freq: number,
  locator?: string
) => {
  const tau = Math.PI * 2
  const deg = tau / 360
  const step = dist / steps
  for (let i = 0, j = 0; i < dist; i += step, j += 1) {
    if (locator) {
      const isElVis = await page.locator(locator).isVisible()
      if (isElVis) return
    }
    const [x1, y1] = [0, Math.sin((tau / steps) * j * freq) * amplitude]
    const [x2, y2] = [
      Math.cos(-ang * deg) * i - Math.sin(-ang * deg) * y1,
      Math.sin(-ang * deg) * i + Math.cos(-ang * deg) * y1,
    ]
    const [xr, yr] = [x2, y2]
    await page.mouse.move(x + xr, y + yr, { steps: 5 })
  }
}

export const circleMove = async (
  page: any,
  x: number,
  y: number,
  steps: number,
  diameter: number,
  locator?: string
) => {
  const tau = Math.PI * 2
  const step = tau / steps
  for (let i = 0; i < tau; i += step) {
    if (locator) {
      const isElVis = await page.locator(locator).isVisible()
      if (isElVis) return
    }
    const [x1, y1] = [Math.cos(i) * diameter, Math.sin(i) * diameter]
    const [xr, yr] = [x1, y1]
    await page.mouse.move(x + xr, y + yr, { steps: 5 })
  }
}

export const getMovementUtils = (opts: any) => {
  // The way we truncate is kinda odd apparently, so we need this function
  // "[k]itty[c]ad round"
  const kcRound = (n: number) => Math.trunc(n * 100) / 100

  // To translate between screen and engine ("[U]nit") coordinates
  // NOTE: these pretty much can't be perfect because of screen scaling.
  // Handle on a case-by-case.
  const toU = (x: number, y: number) => [
    kcRound(x * 0.0678),
    kcRound(-y * 0.0678), // Y is inverted in our coordinate system
  ]

  // Turn the array into a string with specific formatting
  const fromUToString = (xy: number[]) => `[${xy[0]}, ${xy[1]}]`

  // Combine because used often
  const toSU = (xy: number[]) => fromUToString(toU(xy[0], xy[1]))

  // Make it easier to click around from center ("click [from] zero zero")
  const click00 = (x: number, y: number) =>
    opts.page.mouse.click(opts.center.x + x, opts.center.y + y, { delay: 100 })

  // Relative clicker, must keep state
  let last = { x: 0, y: 0 }
  const click00r = async (x?: number, y?: number) => {
    // reset relative coordinates when anything is undefined
    if (x === undefined || y === undefined) {
      last.x = 0
      last.y = 0
      return
    }

    await circleMove(
      opts.page,
      opts.center.x + last.x + x,
      opts.center.y + last.y + y,
      10,
      10
    )
    await click00(last.x + x, last.y + y)
    last.x += x
    last.y += y

    // Returns the new absolute coordinate if you need it.
    return [last.x, last.y]
  }

  return { toSU, click00r }
}

export async function getUtils(page: Page) {
  // Chrome devtools protocol session only works in Chromium
  const browserType = page.context().browser()?.browserType().name()
  const cdpSession =
    browserType !== 'chromium' ? null : await page.context().newCDPSession(page)

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
    getSegmentBodyCoords: async (locator: string, px = 30) => {
      const overlay = page.locator(locator)
      const bbox = await overlay
        .boundingBox()
        .then((box) => ({ ...box, x: box?.x || 0, y: box?.y || 0 }))
      const angle = Number(await overlay.getAttribute('data-overlay-angle'))
      const angleXOffset = Math.cos(((angle - 180) * Math.PI) / 180) * px
      const angleYOffset = Math.sin(((angle - 180) * Math.PI) / 180) * px
      return {
        x: Math.round(bbox.x + angleXOffset),
        y: Math.round(bbox.y - angleYOffset),
      }
    },
    getAngle: async (locator: string) => {
      const overlay = page.locator(locator)
      return Number(await overlay.getAttribute('data-overlay-angle'))
    },
    getBoundingBox: async (locator: string) =>
      page
        .locator(locator)
        .boundingBox()
        .then((box) => ({ ...box, x: box?.x || 0, y: box?.y || 0 })),
    codeLocator: page.locator('.cm-content'),
    canvasLocator: page.getByTestId('client-side-scene'),
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
    /**
     * Given an expected RGB value, diff if the channel with the largest difference
     */
    getGreatestPixDiff: async (
      coords: { x: number; y: number },
      expected: [number, number, number]
    ): Promise<number> => {
      const buffer = await page.screenshot({
        fullPage: true,
      })
      const screenshot = await PNG.sync.read(buffer)
      // most likely related to pixel density but the screenshots for webkit are 2x the size
      // there might be a more robust way of doing this.
      const pixMultiplier = browserType === 'webkit' ? 2 : 1
      const index =
        (screenshot.width * coords.y * pixMultiplier +
          coords.x * pixMultiplier) *
        4 // rbga is 4 channels
      return Math.max(
        Math.abs(screenshot.data[index] - expected[0]),
        Math.abs(screenshot.data[index + 1] - expected[1]),
        Math.abs(screenshot.data[index + 2] - expected[2])
      )
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
    emulateNetworkConditions: async (
      networkOptions: Protocol.Network.emulateNetworkConditionsParameters
    ) => {
      // Skip on non-Chromium browsers, since we need to use the CDP.
      test.skip(
        cdpSession === null,
        'Network emulation is only supported in Chromium'
      )

      cdpSession?.send('Network.emulateNetworkConditions', networkOptions)
    },
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
 * Tool for making templates to match code snippets in the editor with some fudge factor,
 * as there's some level of non-determinism.
 *
 * Usage is as such:
 * ```typescript
 * const result = makeTemplate`const myVar = aFunc(${[1, 2, 3]})`
 * await expect(page.locator('.cm-content')).toHaveText(result.regExp)
 * ```
 * Where the value `1`, `2` or `3` are all valid and should make the test pass.
 *
 * The function also has a `genNext` function that allows you to chain multiple templates
 * together without having to repeat previous parts of the template.
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

export interface Paths {
  modelPath: string
  imagePath: string
  outputType: string
}

export const doExport = async (
  output: Models['OutputFormat_type'],
  page: Page
): Promise<Paths> => {
  await page.getByRole('button', { name: APP_NAME }).click()
  await expect(page.getByRole('button', { name: 'Export Part' })).toBeVisible()
  await page.getByRole('button', { name: 'Export Part' }).click()
  await expect(page.getByTestId('command-bar')).toBeVisible()

  // Go through export via command bar
  await page.getByRole('option', { name: output.type, exact: false }).click()
  await page.locator('#arg-form').waitFor({ state: 'detached' })
  if ('storage' in output) {
    await page.getByTestId('arg-name-storage').waitFor({ timeout: 1000 })
    await page.getByRole('button', { name: 'storage', exact: false }).click()
    await page
      .getByRole('option', { name: output.storage, exact: false })
      .click()
    await page.locator('#arg-form').waitFor({ state: 'detached' })
  }
  await expect(page.getByText('Confirm Export')).toBeVisible()

  const getPromiseAndResolve = () => {
    let resolve: any = () => {}
    const promise = new Promise<Download>((r) => {
      resolve = r
    })
    return [promise, resolve]
  }

  const [downloadPromise1, downloadResolve1] = getPromiseAndResolve()
  let downloadCnt = 0

  page.on('download', async (download) => {
    if (downloadCnt === 0) {
      downloadResolve1(download)
    }
    downloadCnt++
  })
  await page.getByRole('button', { name: 'Submit command' }).click()

  // Handle download
  const download = await downloadPromise1
  const downloadLocationer = (extra = '', isImage = false) =>
    `./e2e/playwright/export-snapshots/${output.type}-${
      'storage' in output ? output.storage : ''
    }${extra}.${isImage ? 'png' : output.type}`
  const downloadLocation = downloadLocationer()

  await download.saveAs(downloadLocation)

  if (output.type === 'step') {
    // stable timestamps for step files
    const fileContents = await fsp.readFile(downloadLocation, 'utf-8')
    const newFileContents = fileContents.replace(
      /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+[0-9]+[0-9]\+[0-9]{2}:[0-9]{2}/g,
      '1970-01-01T00:00:00.0+00:00'
    )
    await fsp.writeFile(downloadLocation, newFileContents)
  }

  return {
    modelPath: downloadLocation,
    imagePath: downloadLocationer('', true),
    outputType: output.type,
  }
}

/**
 * Gets the appropriate modifier key for the platform.
 */
export const metaModifier = os.platform() === 'darwin' ? 'Meta' : 'Control'
