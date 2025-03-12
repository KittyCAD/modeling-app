import {
  expect,
  BrowserContext,
  TestInfo,
  _electron as electron,
  ElectronApplication,
  Locator,
} from '@playwright/test'
import { test, Page } from './zoo-test'
import { EngineCommand } from 'lang/std/artifactGraph'
import fsp from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import pixelMatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { Protocol } from 'playwright-core/types/protocol'
import type { Models } from '@kittycad/lib'
import { COOKIE_NAME } from 'lib/constants'
import { secrets } from './secrets'
import {
  TEST_SETTINGS_KEY,
  TEST_SETTINGS,
  IS_PLAYWRIGHT_KEY,
} from './storageStates'
import * as TOML from '@iarna/toml'
import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
import { SETTINGS_FILE_NAME } from 'lib/constants'
import { isErrorWhitelisted } from './lib/console-error-whitelist'
import { isArray } from 'lib/utils'
import { reportRejection } from 'lib/trap'
import { DeepPartial } from 'lib/types'
import { Configuration } from 'lang/wasm'
import { Settings } from '@rust/kcl-lib/bindings/Settings'
import { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'

const toNormalizedCode = (text: string) => {
  return text.replace(/\s+/g, '')
}

type TestColor = [number, number, number]
export const TEST_COLORS = {
  WHITE: [249, 249, 249] as TestColor,
  YELLOW: [255, 255, 0] as TestColor,
  BLUE: [0, 0, 255] as TestColor,
} as const

export const PERSIST_MODELING_CONTEXT = 'persistModelingContext'

export const deg = (Math.PI * 2) / 360

export const commonPoints = {
  startAt: '[7.19, -9.7]',
  num1: 7.25,
  num2: 14.44,
  /** The Y-value of a common lineTo move we perform in tests */
  num3: -2.44,
} as const

/** A semi-reliable color to check the default XZ plane on
 * in dark mode in the default camera position
 */
export const darkModePlaneColorXZ: [number, number, number] = [50, 50, 99]

/** A semi-reliable color to check the default dark mode bg color against */
export const darkModeBgColor: [number, number, number] = [27, 27, 27]

export const editorSelector = '[role="textbox"][data-language="kcl"]'
type PaneId = 'variables' | 'code' | 'files' | 'logs'

async function waitForPageLoadWithRetry(page: Page) {
  await expect(async () => {
    await page.goto('/')
    const errorMessage = 'App failed to load - 🔃 Retrying ...'
    await expect(page.getByTestId('loading'), errorMessage).not.toBeAttached({
      timeout: 20_000,
    })

    await expect(
      page.getByRole('button', { name: 'sketch Start Sketch' }),
      errorMessage
    ).toBeEnabled({
      timeout: 20_000,
    })
  }).toPass({ timeout: 70_000, intervals: [1_000] })
}

async function waitForPageLoad(page: Page) {
  // wait for all spinners to be gone
  await expect(page.getByTestId('loading')).not.toBeAttached({
    timeout: 20_000,
  })

  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeEnabled({
    timeout: 20_000,
  })
}

async function removeCurrentCode(page: Page) {
  await page.locator('.cm-content').click()
  await page.keyboard.down('ControlOrMeta')
  await page.keyboard.press('a')
  await page.keyboard.up('ControlOrMeta')
  await page.keyboard.press('Backspace')
  await expect(page.locator('.cm-content')).toHaveText('')
}

export async function sendCustomCmd(page: Page, cmd: EngineCommand) {
  const json = JSON.stringify(cmd)
  await page.getByTestId('custom-cmd-input').fill(json)
  await expect(page.getByTestId('custom-cmd-input')).toHaveValue(json)
  await page.getByTestId('custom-cmd-send-button').scrollIntoViewIfNeeded()
  await page.getByTestId('custom-cmd-send-button').click()
}

async function clearCommandLogs(page: Page) {
  await page.getByTestId('custom-cmd-input').fill('')
  await page.getByTestId('clear-commands').scrollIntoViewIfNeeded()
  await page.getByTestId('clear-commands').click()
}

async function expectCmdLog(page: Page, locatorStr: string, timeout = 5000) {
  await expect(page.locator(locatorStr).last()).toBeVisible({ timeout })
}

// Ignoring the lint since I assume someone will want to use this for a test.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function waitForDefaultPlanesToBeVisible(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-receive-command-type="object_visible"]')
        .length >= 3
  )
}

export async function checkIfPaneIsOpen(page: Page, testId: string) {
  const paneButtonLocator = page.getByTestId(testId)
  await expect(paneButtonLocator).toBeVisible()
  return (await paneButtonLocator?.getAttribute('aria-pressed')) === 'true'
}

export async function openPane(page: Page, testId: string) {
  const paneButtonLocator = page.getByTestId(testId)
  await expect(paneButtonLocator).toBeVisible()
  const isOpen = await checkIfPaneIsOpen(page, testId)

  if (!isOpen) {
    await paneButtonLocator.click()
  }
  await expect(paneButtonLocator).toHaveAttribute('aria-pressed', 'true')
}

export async function closePane(page: Page, testId: string) {
  const paneButtonLocator = page.getByTestId(testId)
  await expect(paneButtonLocator).toBeVisible()
  const isOpen = await checkIfPaneIsOpen(page, testId)

  if (isOpen) {
    await paneButtonLocator.click()
  }
  await expect(paneButtonLocator).toHaveAttribute('aria-pressed', 'false')
}

async function openKclCodePanel(page: Page) {
  await openPane(page, 'code-pane-button')

  // Code Mirror lazy loads text! Wowza! Let's force-load the text for tests.
  await page.evaluate(() => {
    // editorManager is available on the window object.
    //@ts-ignore this is in an entirely different context that tsc can't see.
    editorManager._editorView.dispatch({
      selection: {
        //@ts-ignore this is in an entirely different context that tsc can't see.
        anchor: editorManager._editorView.docView.length,
      },
      scrollIntoView: true,
    })
  })
}

async function closeKclCodePanel(page: Page) {
  const paneLocator = page.getByTestId('code-pane-button')
  const ariaSelected = await paneLocator?.getAttribute('aria-pressed')
  const isOpen = ariaSelected === 'true'

  if (isOpen) {
    await paneLocator.click()
    await expect(paneLocator).not.toHaveAttribute('aria-pressed', 'true')
  }
}

async function openDebugPanel(page: Page) {
  await openPane(page, 'debug-pane-button')

  // The debug pane needs time to load everything.
  await page.waitForTimeout(3000)
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

async function openFilePanel(page: Page) {
  await openPane(page, 'files-pane-button')
}

async function closeFilePanel(page: Page) {
  const fileLocator = page.getByTestId('files-pane-button')
  await expect(fileLocator).toBeVisible()
  const isOpen = (await fileLocator?.getAttribute('aria-pressed')) === 'true'
  if (isOpen) {
    await fileLocator.click()
    await expect(fileLocator).not.toHaveAttribute('aria-pressed', 'true')
  }
}

async function openVariablesPane(page: Page) {
  await openPane(page, 'variables-pane-button')
}

async function openLogsPane(page: Page) {
  await openPane(page, 'logs-pane-button')
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
    // x1 is 0.
    const y1 = Math.sin((tau / steps) * j * freq) * amplitude
    const [x2, y2] = [
      Math.cos(-ang * deg) * i - Math.sin(-ang * deg) * y1,
      Math.sin(-ang * deg) * i + Math.cos(-ang * deg) * y1,
    ]
    const [xr, yr] = [x2, y2]
    await page.mouse.move(x + xr, y + yr, { steps: 5 })
  }
}

export const circleMove = async (
  page: Page,
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

  return { toSU, toU, click00r }
}

async function waitForAuthAndLsp(page: Page) {
  const waitForLspPromise = page.waitForEvent('console', {
    predicate: async (message) => {
      // it would be better to wait for a message that the kcl lsp has started by looking for the message  message.text().includes('[lsp] [window/logMessage]')
      // but that doesn't seem to make it to the console for macos/safari :(
      if (message.text().includes('start kcl lsp')) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return true
      }
      return false
    },
    timeout: 45_000,
  })
  if (process.env.CI) {
    await waitForPageLoadWithRetry(page)
  } else {
    await page.goto('/')
    await waitForPageLoad(page)
  }

  return waitForLspPromise
}

export function normaliseKclNumbers(code: string, ignoreZero = true): string {
  const numberRegexp = /(?<!\w)-?\b\d+(\.\d+)?\b(?!\w)/g
  const replaceNumber = (number: string) => {
    if (ignoreZero && (number === '0' || number === '-0')) return number
    const sign = number.startsWith('-') ? '-' : ''
    return `${sign}12.34`
  }
  const replaceNumbers = (text: string) =>
    text.replace(numberRegexp, replaceNumber)
  return replaceNumbers(code)
}

export async function getUtils(page: Page, test_?: typeof test) {
  if (!test) {
    console.warn(
      'Some methods in getUtils requires test object as second argument'
    )
  }

  // Chrome devtools protocol session only works in Chromium
  const browserType = page.context().browser()?.browserType().name()
  const cdpSession =
    browserType !== 'chromium' ? null : await page.context().newCDPSession(page)

  const util = {
    waitForAuthSkipAppStart: () => waitForAuthAndLsp(page),
    waitForPageLoad: () => waitForPageLoad(page),
    waitForPageLoadWithRetry: () => waitForPageLoadWithRetry(page),
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
    expectCmdLog: (locatorStr: string, timeout = 5000) =>
      expectCmdLog(page, locatorStr, timeout),
    openKclCodePanel: () => openKclCodePanel(page),
    closeKclCodePanel: () => closeKclCodePanel(page),
    openDebugPanel: () => openDebugPanel(page),
    closeDebugPanel: () => closeDebugPanel(page),
    openFilePanel: () => openFilePanel(page),
    closeFilePanel: () => closeFilePanel(page),
    openVariablesPane: () => openVariablesPane(page),
    openLogsPane: () => openLogsPane(page),
    openAndClearDebugPanel: () => openAndClearDebugPanel(page),
    clearAndCloseDebugPanel: async () => {
      await clearCommandLogs(page)
      return closeDebugPanel(page)
    },
    waitForCmdReceive: (commandType: string) =>
      waitForCmdReceive(page, commandType),
    getSegmentBodyCoords: async (locator: string, px = 30) => {
      const overlay = page.locator(locator)
      const bbox = await overlay
        .boundingBox({ timeout: 5_000 })
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
        .boundingBox({ timeout: 5_000 })
        .then((box) => ({ ...box, x: box?.x || 0, y: box?.y || 0 })),
    codeLocator: page.locator('.cm-content'),
    crushKclCodeIntoOneLineAndThenMaybeSome: async () => {
      const code = await page.locator('.cm-content').innerText()
      return code.replaceAll(' ', '').replaceAll('\n', '')
    },
    normalisedEditorCode: async () => {
      const code = await page.locator('.cm-content').innerText()
      return normaliseKclNumbers(code)
    },
    normalisedCode: (code: string) => normaliseKclNumbers(code),
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
      const pixMultiplier: number = await page.evaluate(
        'window.devicePixelRatio'
      )
      const index =
        (screenshot.width * coords.y * pixMultiplier +
          coords.x * pixMultiplier) *
        4 // rbga is 4 channels
      const maxDiff = Math.max(
        Math.abs(screenshot.data[index] - expected[0]),
        Math.abs(screenshot.data[index + 1] - expected[1]),
        Math.abs(screenshot.data[index + 2] - expected[2])
      )
      if (maxDiff > 4) {
        console.log(
          `Expected: ${expected} Actual: [${screenshot.data[index]}, ${
            screenshot.data[index + 1]
          }, ${screenshot.data[index + 2]}]`
        )
      }
      return maxDiff
    },
    getPixelRGBs: getPixelRGBs(page),
    doAndWaitForImageDiff: (fn: () => Promise<unknown>, diffCount = 200) =>
      doAndWaitForImageDiff(page, fn, diffCount),
    emulateNetworkConditions: async (
      networkOptions: Protocol.Network.emulateNetworkConditionsParameters
    ) => {
      if (cdpSession === null) {
        // Use a fail safe if we can't simulate disconnect (on Safari)
        return page.evaluate('window.tearDown()')
      }

      return cdpSession?.send(
        'Network.emulateNetworkConditions',
        networkOptions
      )
    },

    toNormalizedCode(text: string) {
      return toNormalizedCode(text)
    },

    async editorTextMatches(code: string) {
      const editor = page.locator(editorSelector)
      return expect
        .poll(async () => {
          const text = await editor.textContent()
          return toNormalizedCode(text ?? '')
        })
        .toContain(toNormalizedCode(code))
    },

    pasteCodeInEditor: async (code: string) => {
      return test?.step('Paste in KCL code', async () => {
        const editor = page.locator(editorSelector)
        await editor.fill(code)
        await util.editorTextMatches(code)
      })
    },

    clickPane: async (paneId: PaneId) => {
      return test?.step(`Open ${paneId} pane`, async () => {
        await page.getByTestId(paneId + '-pane-button').click()
        await expect(page.locator('#' + paneId + '-pane')).toBeVisible()
      })
    },

    createNewFile: async (name: string) => {
      return test?.step(`Create a file named ${name}`, async () => {
        // If the application is in the middle of connecting a stream
        // then creating a new file won't work in the end.
        await expect(
          page.getByRole('button', { name: 'Start Sketch' })
        ).not.toBeDisabled()
        await page.getByTestId('create-file-button').click()
        await page.getByTestId('tree-input-field').fill(name)
        await page.keyboard.press('Enter')
      })
    },

    cloneFile: async (name: string) => {
      return test?.step(`Cloning file '${name}'`, async () => {
        await page
          .locator('[data-testid="file-pane-scroll-container"] button')
          .filter({ hasText: name })
          .click({ button: 'right' })
        await page.getByTestId('context-menu-clone').click()
      })
    },

    selectFile: async (name: string) => {
      return test?.step(`Select ${name}`, async () => {
        await page
          .locator('[data-testid="file-pane-scroll-container"] button')
          .filter({ hasText: name })
          .click()
        await expect(page.getByTestId('project-sidebar-toggle')).toContainText(
          name
        )
      })
    },

    createNewFileAndSelect: async (name: string) => {
      return test?.step(`Create a file named ${name}, select it`, async () => {
        await openFilePanel(page)
        await page.getByTestId('create-file-button').click()
        await page.getByTestId('file-rename-field').fill(name)
        await page.keyboard.press('Enter')
        const newFile = page
          .locator('[data-testid="file-pane-scroll-container"] button')
          .filter({ hasText: name })

        await expect(newFile).toBeVisible()
        await newFile.click()
      })
    },

    renameFile: async (fromName: string, toName: string) => {
      return test?.step(`Rename ${fromName} to ${toName}`, async () => {
        await page
          .locator('[data-testid="file-pane-scroll-container"] button')
          .filter({ hasText: fromName })
          .click({ button: 'right' })
        await page.getByTestId('context-menu-rename').click()
        await page.getByTestId('file-rename-field').fill(toName)
        await page.keyboard.press('Enter')
        await page
          .locator('[data-testid="file-pane-scroll-container"] button')
          .filter({ hasText: toName })
          .click()
      })
    },

    deleteFile: async (name: string) => {
      return test?.step(`Delete ${name}`, async () => {
        await page
          .locator('[data-testid="file-pane-scroll-container"] button')
          .filter({ hasText: name })
          .click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await page.getByTestId('delete-confirmation').click()
      })
    },

    /**
     * @deprecated Sorry I don't have time to fix this right now, but runs like
     * the one linked below show me that setting the open panes in this manner is not reliable.
     * You can either set `openPanes` as a part of the same initScript we run in setupElectron/setup,
     * or you can imperatively open the panes with functions like {openKclCodePanel}
     * (or we can make a general openPane function that takes a paneId).,
     * but having a separate initScript does not seem to work reliably.
     * @link https://github.com/KittyCAD/modeling-app/actions/runs/10731890169/job/29762700806?pr=3807#step:20:19553
     */
    panesOpen: async (paneIds: PaneId[]) => {
      return test?.step(`Setting ${paneIds} panes to be open`, async () => {
        await page.addInitScript(
          ({ PERSIST_MODELING_CONTEXT, paneIds }) => {
            localStorage.setItem(
              PERSIST_MODELING_CONTEXT,
              JSON.stringify({ openPanes: paneIds })
            )
          },
          { PERSIST_MODELING_CONTEXT, paneIds }
        )
        await page.reload()
      })
    },
  }

  return util
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
  const length = Math.max(...options.map((a) => (isArray(a) ? a[0] : 0)))
  let reExpTemplate = ''
  for (let i = 0; i < length; i++) {
    const currentStr = templateParts.map((str, index) => {
      const currentOptions = options[index]
      return (
        escapeRegExp(str) +
        String(
          isArray(currentOptions)
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

const PLAYWRIGHT_DOWNLOAD_DIR = 'downloads-during-playwright'

export const getPlaywrightDownloadDir = (page: Page) => {
  return path.resolve(page.dir, PLAYWRIGHT_DOWNLOAD_DIR)
}

const moveDownloadedFileTo = async (page: Page, toLocation: string) => {
  await fsp.mkdir(path.dirname(toLocation), { recursive: true })

  const downloadDir = getPlaywrightDownloadDir(page)

  // Expect there to be at least one file
  await expect
    .poll(async () => {
      const files = await fsp.readdir(downloadDir)
      return files.length
    })
    .toBeGreaterThan(0)

  // Go through the downloads dir and move files to new location
  const files = await fsp.readdir(downloadDir)

  // Assumption: only ever one file here.
  for (let file of files) {
    await fsp.rename(path.resolve(downloadDir, file), toLocation)
  }
}

export interface Paths {
  modelPath: string
  imagePath: string
  outputType: string
}

export const doExport = async (
  output: Models['OutputFormat_type'],
  page: Page,
  exportFrom: 'dropdown' | 'sidebarButton' | 'commandBar' = 'dropdown'
): Promise<Paths> => {
  if (exportFrom === 'dropdown') {
    await page.getByTestId('project-sidebar-toggle').click()

    const exportMenuButton = page.getByRole('button', {
      name: 'Export current part',
    })
    await expect(exportMenuButton).toBeVisible()
    await exportMenuButton.click()
  } else if (exportFrom === 'sidebarButton') {
    await expect(page.getByTestId('export-pane-button')).toBeVisible()
    await page.getByTestId('export-pane-button').click()
  } else if (exportFrom === 'commandBar') {
    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    await expect(commandBarButton).toBeVisible()
    // Click the command bar button
    await commandBarButton.click()

    // Wait for the command bar to appear
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()

    const textToCadCommand = page.getByRole('option', {
      name: 'floppy disk arrow Export',
    })
    await expect(textToCadCommand.first()).toBeVisible()
    // Click the Text-to-CAD command
    await textToCadCommand.first().click()
  }
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

  await page.getByRole('button', { name: 'Submit command' }).click()

  // This usually happens immediately after. If we're too slow we don't
  // catch it.
  await expect(page.getByText('Exported successfully')).toBeVisible()

  if (exportFrom === 'sidebarButton' || exportFrom === 'commandBar') {
    return {
      modelPath: '',
      imagePath: '',
      outputType: output.type,
    }
  }

  // Handle download
  const downloadLocationer = (extra = '', isImage = false) =>
    `./e2e/playwright/export-snapshots/${output.type}-${
      'storage' in output ? output.storage : ''
    }${extra}.${isImage ? 'png' : output.type}`
  const downloadLocation = downloadLocationer()

  if (output.type === 'step') {
    // stable timestamps for step files
    const fileContents = await fsp.readFile(downloadLocation, 'utf-8')
    const newFileContents = fileContents.replace(
      /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+[0-9]+[0-9]\+[0-9]{2}:[0-9]{2}/g,
      '1970-01-01T00:00:00.0+00:00'
    )
    await fsp.writeFile(downloadLocation, newFileContents)
  } else {
    // By default all files are downloaded to the same place in playwright
    // (declared in src/lib/exportSave)
    // To remain consistent with our old web tests, we want to move some downloads
    // (images) to another directory.
    await moveDownloadedFileTo(page, downloadLocation)
  }

  return {
    modelPath: downloadLocation,
    imagePath: downloadLocationer('', true),
    outputType: output.type,
  }
}

export async function tearDown(page: Page, testInfo: TestInfo) {
  if (testInfo.status === 'skipped') return
  if (testInfo.status === 'failed') return

  const u = await getUtils(page)
  // Kill the network so shutdown happens properly
  await u.emulateNetworkConditions({
    offline: true,
    // values of 0 remove any active throttling. crbug.com/456324#c9
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  // It seems it's best to give the browser about 3s to close things
  // It's not super reliable but we have no real other choice for now
  await page.waitForTimeout(3000)

  await testInfo.tronApp?.close()
}

// settingsOverrides may need to be augmented to take more generic items,
// but we'll be strict for now
export async function setup(
  context: BrowserContext,
  page: Page,
  testInfo?: TestInfo
) {
  await context.addInitScript(
    async ({
      token,
      settingsKey,
      settings,
      IS_PLAYWRIGHT_KEY,
      PLAYWRIGHT_TEST_DIR,
      PERSIST_MODELING_CONTEXT,
    }) => {
      localStorage.clear()
      localStorage.setItem('TOKEN_PERSIST_KEY', token)
      localStorage.setItem('persistCode', ``)
      localStorage.setItem(
        PERSIST_MODELING_CONTEXT,
        JSON.stringify({ openPanes: ['code'] })
      )
      localStorage.setItem(settingsKey, settings)
      localStorage.setItem(IS_PLAYWRIGHT_KEY, 'true')
      localStorage.setItem('PLAYWRIGHT_TEST_DIR', PLAYWRIGHT_TEST_DIR)
    },
    {
      token: secrets.token,
      settingsKey: TEST_SETTINGS_KEY,
      settings: settingsToToml({
        settings: {
          ...TEST_SETTINGS,
          app: {
            ...TEST_SETTINGS.project,
            project_directory: TEST_SETTINGS.app?.project_directory,
            onboarding_status: 'dismissed',
            theme: 'dark',
          },
        },
      }),
      IS_PLAYWRIGHT_KEY,
      PLAYWRIGHT_TEST_DIR: TEST_SETTINGS.app?.project_directory || '',
      PERSIST_MODELING_CONTEXT,
    }
  )

  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: secrets.token,
      path: '/',
      domain: 'localhost',
      secure: true,
    },
  ])

  failOnConsoleErrors(page, testInfo)
  // kill animations, speeds up tests and reduced flakiness
  await page.emulateMedia({ reducedMotion: 'reduce' })

  // Trigger a navigation, since loading file:// doesn't.
  // await page.reload()
}

let electronApp: ElectronApplication | undefined = undefined
let context: BrowserContext | undefined = undefined
let page: Page | undefined = undefined

export async function setupElectron({
  testInfo,
  cleanProjectDir = true,
  appSettings,
  viewport,
}: {
  testInfo: TestInfo
  folderSetupFn?: (projectDirName: string) => Promise<void>
  cleanProjectDir?: boolean
  appSettings?: DeepPartial<Settings>
  viewport: {
    width: number
    height: number
  }
}): Promise<{
  electronApp: ElectronApplication
  context: BrowserContext
  page: Page
  dir: string
}> {
  // create or otherwise clear the folder
  const projectDirName = testInfo.outputPath('electron-test-projects-dir')
  try {
    if (fsSync.existsSync(projectDirName) && cleanProjectDir) {
      await fsp.rm(projectDirName, { recursive: true })
    }
  } catch (e) {
    console.error(e)
  }

  if (cleanProjectDir) {
    await fsp.mkdir(projectDirName)
  }

  const options = {
    args: ['.', '--no-sandbox'],
    env: {
      ...process.env,
      TEST_SETTINGS_FILE_KEY: projectDirName,
      IS_PLAYWRIGHT: 'true',
    },
    ...(process.env.ELECTRON_OVERRIDE_DIST_PATH
      ? { executablePath: process.env.ELECTRON_OVERRIDE_DIST_PATH + 'electron' }
      : {}),
    ...(process.env.PLAYWRIGHT_RECORD_VIDEO
      ? {
          recordVideo: {
            dir: testInfo.snapshotPath(),
            size: viewport,
          },
        }
      : {}),
  }

  // Do this once and then reuse window on subsequent calls.
  if (!electronApp) {
    electronApp = await electron.launch(options)
  }

  if (!context || !page) {
    context = electronApp.context()
    page = await electronApp.firstWindow()
    context.on('console', console.log)
    page.on('console', console.log)
  }

  if (cleanProjectDir) {
    const tempSettingsFilePath = path.join(projectDirName, SETTINGS_FILE_NAME)
    const settingsOverrides = settingsToToml(
      appSettings
        ? {
            settings: {
              ...TEST_SETTINGS,
              ...appSettings,
              app: {
                ...TEST_SETTINGS.app,
                project_directory: projectDirName,
                ...appSettings.app,
              },
            },
          }
        : {
            settings: {
              ...TEST_SETTINGS,
              app: {
                ...TEST_SETTINGS.app,
                project_directory: projectDirName,
              },
            },
          }
    )
    await fsp.writeFile(tempSettingsFilePath, settingsOverrides)
  }

  return { electronApp, page, context, dir: projectDirName }
}

function failOnConsoleErrors(page: Page, testInfo?: TestInfo) {
  // enabled for chrome for now
  if (page.context().browser()?.browserType().name() === 'chromium') {
    page.on('pageerror', (exception) => {
      if (isErrorWhitelisted(exception)) {
        return
      }

      // only set this env var to false if you want to collect console errors
      // This can be configured in the GH workflow.  This should be set to true by default (we want tests to fail when
      // unwhitelisted console errors are detected).
      if (process.env.FAIL_ON_CONSOLE_ERRORS === 'true') {
        // Fail when running on CI and FAIL_ON_CONSOLE_ERRORS is set
        // use expect to prevent page from closing and not cleaning up
        expect(`An error was detected in the console: \r\n message:${exception.message} \r\n name:${exception.name} \r\n stack:${exception.stack}

          *Either fix the console error or add it to the whitelist defined in ./lib/console-error-whitelist.ts (if the error can be safely ignored)
          `).toEqual('Console error detected')
      } else {
        // the (test-results/exceptions.txt) file will be uploaded as part of an upload artifact in GH
        fsp
          .appendFile(
            './test-results/exceptions.txt',
            [
              '~~~',
              `triggered_by_test:${
                testInfo?.file + ' ' + (testInfo?.title || ' ')
              }`,
              `name:${exception.name}`,
              `message:${exception.message}`,
              `stack:${exception.stack}`,
              `project:${testInfo?.project.name}`,
              '~~~',
            ].join('\n')
          )
          .catch((err) => {
            console.error(err)
          })
      }
    })
  }
}
export async function isOutOfViewInScrollContainer(
  element: Locator,
  container: Locator
): Promise<boolean> {
  const elementBox = await element.boundingBox({ timeout: 5_000 })
  const containerBox = await container.boundingBox({ timeout: 5_000 })

  let isOutOfView = false
  if (elementBox && containerBox)
    return (
      elementBox.y + elementBox.height > containerBox.y + containerBox.height ||
      elementBox.y < containerBox.y ||
      elementBox.x + elementBox.width > containerBox.x + containerBox.width ||
      elementBox.x < containerBox.x
    )

  return isOutOfView
}

export async function createProject({
  name,
  page,
  returnHome = false,
}: {
  name: string
  page: Page
  returnHome?: boolean
}) {
  await test.step(`Create project and navigate to it`, async () => {
    await page.getByRole('button', { name: 'Create project' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill(name)
    await page.getByRole('button', { name: 'Continue' }).click()

    if (returnHome) {
      await page.waitForURL('**/file/**', { waitUntil: 'domcontentloaded' })
      await page.getByTestId('app-logo').click()
    }
  })
}

export function executorInputPath(fileName: string): string {
  return path.join('rust', 'kcl-lib', 'e2e', 'executor', 'inputs', fileName)
}

export async function doAndWaitForImageDiff(
  page: Page,
  fn: () => Promise<unknown>,
  diffCount = 200
) {
  return new Promise<boolean>((resolve) => {
    ;(async () => {
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
      const interval = setInterval(() => {
        ;(async () => {
          count++
          if (await isImageDiff()) {
            clearInterval(interval)
            resolve(true)
          } else if (count > 100) {
            clearInterval(interval)
            resolve(false)
          }
        })().catch(reportRejection)
      }, 50)
    })().catch(reportRejection)
  })
}

export async function openAndClearDebugPanel(page: Page) {
  await openDebugPanel(page)
  return clearCommandLogs(page)
}

export function sansWhitespace(str: string) {
  return str.replace(/\s+/g, '').trim()
}

export function getPixelRGBs(page: Page) {
  return async (
    coords: { x: number; y: number },
    radius: number
  ): Promise<[number, number, number][]> => {
    const buffer = await page.screenshot({
      fullPage: true,
    })
    const screenshot = await PNG.sync.read(buffer)
    const pixMultiplier: number = await page.evaluate('window.devicePixelRatio')
    const allCords: [number, number][] = [[coords.x, coords.y]]
    for (let i = 1; i < radius; i++) {
      allCords.push([coords.x + i, coords.y])
      allCords.push([coords.x - i, coords.y])
      allCords.push([coords.x, coords.y + i])
      allCords.push([coords.x, coords.y - i])
    }
    return allCords.map(([x, y]) => {
      const index =
        (screenshot.width * y * pixMultiplier + x * pixMultiplier) * 4 // rbga is 4 channels
      return [
        screenshot.data[index],
        screenshot.data[index + 1],
        screenshot.data[index + 2],
      ]
    })
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

export function settingsToToml(settings: DeepPartial<Configuration>) {
  return TOML.stringify(settings as any)
}

export function tomlToSettings(toml: string): DeepPartial<Configuration> {
  return TOML.parse(toml)
}

export function tomlToPerProjectSettings(toml: string): DeepPartial<ProjectConfiguration> {
  return TOML.parse(toml)
}
