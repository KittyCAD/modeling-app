import path from 'path'
import * as TOML from '@iarna/toml'
import type { OutputFormat3d } from '@kittycad/lib'
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type { Configuration } from '@src/lang/wasm'
import {
  IS_PLAYWRIGHT_KEY,
  COOKIE_NAME_PREFIX,
  LAYOUT_PERSIST_PREFIX,
} from '@src/lib/constants'
import { reportRejection } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import { isArray } from '@src/lib/utils'
import dotenv from 'dotenv'
import fsp from 'fs/promises'
import pixelMatch from 'pixelmatch'
import type { Protocol } from 'playwright-core/types/protocol'
import { PNG } from 'pngjs'

const NODE_ENV = process.env.NODE_ENV || 'development'
dotenv.config({ path: [`.env.${NODE_ENV}.local`, `.env.${NODE_ENV}`] })
export const token =
  process.env.VITE_ZOO_API_TOKEN || process.env.VITE_KITTYCAD_API_TOKEN || ''

/** A string version of a RegExp to get a number that may include a decimal point */
export const NUMBER_REGEXP = '((-)?\\d+(\\.\\d+)?)'

import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'

import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'
import { isErrorWhitelisted } from '@e2e/playwright/lib/console-error-whitelist'
import { TEST_SETTINGS, TEST_SETTINGS_KEY } from '@e2e/playwright/storageStates'
import { test } from '@e2e/playwright/zoo-test'
import {
  type LayoutWithMetadata,
  playwrightLayoutConfig,
  setOpenPanes,
} from '@src/lib/layout'

const toNormalizedCode = (text: string) => {
  return text.replace(/\s+/g, '')
}

export const headerMasks = (page: Page) => [
  page.locator('#app-header'),
  page.locator('#sidebar-top-ribbon'),
  page.locator('#sidebar-bottom-ribbon'),
]

export const lowerRightMasks = (page: Page) => [
  page.getByTestId(/network-toggle/),
  page.getByTestId('billing-remaining-bar'),
]

export type TestColor = [number, number, number]
export const TEST_COLORS: { [key: string]: TestColor } = {
  WHITE: [249, 249, 249],
  OFFWHITE: [237, 237, 237],
  GREY: [142, 142, 142],
  YELLOW: [255, 255, 0],
  BLUE: [0, 0, 255],
  DARK_MODE_BKGD: [27, 27, 27],
  DARK_MODE_PLANE_XZ: [50, 50, 99],
} as const

export const PERSIST_MODELING_CONTEXT = 'persistModelingContext'

export const deg = (Math.PI * 2) / 360

export const editorSelector = '[role="textbox"][data-language="kcl"]'
type PaneId = 'variables' | 'code' | 'files' | 'logs'

export function runningOnLinux() {
  return process.platform === 'linux'
}

export function runningOnMac() {
  return process.platform === 'darwin'
}

export function runningOnWindows() {
  return process.platform === 'win32'
}

// lee: This needs to be replaced by scene.settled() eventually.
async function waitForPageLoad(page: Page) {
  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeEnabled({
    timeout: 20_000,
  })
}

async function removeCurrentCode(page: Page) {
  // First, hover the element in case the current mouse position is in the way
  await page.mouse.move(0, 0)
  await page.locator('.cm-content').click({ delay: 50 })
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
  await expect(paneButtonLocator).not.toHaveAttribute('aria-pressed', 'false')
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
    editorManager.getEditorView().dispatch({
      selection: {
        //@ts-ignore this is in an entirely different context that tsc can't see.
        anchor: editorManager.getEditorView().docView.length,
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

/**
 * Moves the mouse in a sine wave along a vector,
 * useful for emulating organic fluid mouse motion which is not available normally in Playwright.
 * Ex. used to activate the segment overlays by hovering around the sketch segments.
 */
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

/**
 * Moves the mouse in a complete circle about a point.
 * useful for emulating organic "hovering" around motions, which are not available normally in Playwright.
 * Ex. used to activate the segment overlays by hovering around the sketch segments.
 */
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
    predicate: async (message: any) => {
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
  await page.goto('/')
  await waitForPageLoad(page)
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

/**
 * We've written a lot of tests using hard-coded pixel coordinates.
 * This function translates those to stream-relative ones,
 * or can be used to get stream coordinates by ratio.
 *
 * This is a duplicate impl to the one in sceneFixture.ts, for use in util functions
 * which predate the fixture-based test system.
 */
async function convertPagePositionToStream(
  x: number,
  y: number,
  page: Page,
  format: 'pixels' | 'ratio' | undefined = 'pixels'
) {
  const viewportSize = page.viewportSize()
  const streamBoundingBox = await page.getByTestId('stream').boundingBox()
  if (viewportSize === null) {
    throw Error('No viewport')
  }
  if (streamBoundingBox === null) {
    throw Error('No stream to click')
  }

  const resolvedX =
    (x / (format === 'pixels' ? viewportSize.width : 1)) *
      streamBoundingBox.width +
    streamBoundingBox.x
  const resolvedY =
    (y / (format === 'pixels' ? viewportSize.height : 1)) *
      streamBoundingBox.height +
    streamBoundingBox.y

  const resolvedPoint = {
    x: Math.round(resolvedX),
    y: Math.round(resolvedY),
  }

  return resolvedPoint
}

export async function getUtils(page: Page, test_?: typeof test) {
  if (!test) {
    console.warn(
      'Some methods in getUtils requires test object as second argument'
    )
  }

  const util = {
    waitForAuthSkipAppStart: () => waitForAuthAndLsp(page),
    waitForPageLoad: () => waitForPageLoad(page),
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
    goToHomePageFromModeling: () => goToHomePageFromModeling(page),
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
        .then((box: any) => ({ ...box, x: box?.x || 0, y: box?.y || 0 }))
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
      const transformedCoords = await convertPagePositionToStream(
        coords.x,
        coords.y,
        page
      )
      const buffer = await page.screenshot({
        fullPage: true,
      })
      const screenshot = await PNG.sync.read(buffer)
      const pixMultiplier: number = await page.evaluate(
        'window.devicePixelRatio'
      )
      const index =
        (screenshot.width * transformedCoords.y * pixMultiplier +
          transformedCoords.x * pixMultiplier) *
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
    doAndWaitForImageDiff: (
      fn: () => Promise<unknown>,
      diffCount = 200,
      locator?: Locator
    ) => doAndWaitForImageDiff(locator || page, fn, diffCount),
    emulateNetworkConditions: async (
      networkOptions: Protocol.Network.emulateNetworkConditionsParameters
    ) => {
      return networkOptions.offline
        ? page.evaluate('window.engineCommandManager.offline()')
        : page.evaluate('window.engineCommandManager.online()')
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
        await page.getByTestId('create-file-button').click()
        await page.getByTestId('file-rename-field').fill(name)
        await page.keyboard.press('Enter')
      })
    },

    createNewFolder: async (name: string) => {
      return test?.step(`Create a folder named ${name}`, async () => {
        await page.getByTestId('create-folder-button').click()
        await page.getByTestId('file-rename-field').fill(name)
        await page.keyboard.press('Enter')
      })
    },

    cloneFile: async (name: string) => {
      return test?.step(`Cloning file '${name}'`, async () => {
        await page
          .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
          .filter({ hasText: name })
          .click({ button: 'right' })
        await page.getByTestId('context-menu-clone').click()
      })
    },

    selectFile: async (name: string) => {
      return test?.step(`Select ${name}`, async () => {
        await page
          .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
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
          .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
          .filter({ hasText: name })

        await expect(newFile).toBeVisible()
        await newFile.click()
      })
    },

    renameFile: async (fromName: string, toName: string) => {
      return test?.step(`Rename ${fromName} to ${toName}`, async () => {
        await page
          .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
          .filter({ hasText: fromName })
          .click({ button: 'right' })
        await page.getByTestId('context-menu-rename').click()
        await page.getByTestId('file-rename-field').fill(toName)
        await page.keyboard.press('Enter')
        await page
          .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
          .filter({ hasText: toName })
          .click()
      })
    },

    deleteFile: async (name: string) => {
      return test?.step(`Delete ${name}`, async () => {
        await page
          .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
          .filter({ hasText: name })
          .click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await page.getByTestId('delete-confirmation').click()
      })
    },

    locatorFile: (name: string) => {
      return page
        .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
        .filter({ hasText: name })
    },

    locatorFolder: (name: string) => {
      return page
        .locator('[data-testid="file-pane-scroll-container"] [role=treeitem]')
        .filter({ hasText: name })
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
    panesOpen: async (paneIds: string[]) => {
      return test?.step(`Setting ${paneIds} panes to be open`, async () => {
        await page.addInitScript(
          ({ layoutName, layoutPayload }) => {
            localStorage.setItem(layoutName, layoutPayload)
          },
          {
            layoutName: `${LAYOUT_PERSIST_PREFIX}default`,
            layoutPayload: JSON.stringify({
              version: 'v1',
              layout: setOpenPanes(playwrightLayoutConfig, paneIds),
            } satisfies LayoutWithMetadata),
          }
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

export const getPlaywrightDownloadDir = (rootDir: string) => {
  return path.resolve(rootDir, PLAYWRIGHT_DOWNLOAD_DIR)
}

const moveDownloadedFileTo = async (rootDir: string, toLocation: string) => {
  await fsp.mkdir(path.dirname(toLocation), { recursive: true })

  const downloadDir = getPlaywrightDownloadDir(rootDir)

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
  output: OutputFormat3d,
  rootDir: string,
  page: Page,
  cmdBar: CmdBarFixture,
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
  await cmdBar.submit()

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
    await moveDownloadedFileTo(rootDir, downloadLocation)
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
}

// settingsOverrides may need to be augmented to take more generic items,
// but we'll be strict for now
export async function setup(
  context: BrowserContext,
  page: Page,
  testInfo?: TestInfo
) {
  await page.addInitScript(
    async ({
      token,
      settingsKey,
      settings,
      IS_PLAYWRIGHT_KEY,
      layoutName,
      layoutPayload,
    }) => {
      localStorage.clear()
      localStorage.setItem('TOKEN_PERSIST_KEY', token)
      localStorage.setItem('persistCode', ``)
      localStorage.setItem(layoutName, layoutPayload)
      localStorage.setItem(settingsKey, settings)
      localStorage.setItem(IS_PLAYWRIGHT_KEY, 'true')
      window.addEventListener('beforeunload', () => {
        localStorage.removeItem(IS_PLAYWRIGHT_KEY)
      })
    },
    {
      token,
      settingsKey: TEST_SETTINGS_KEY,
      settings: settingsToToml({
        settings: {
          ...TEST_SETTINGS,
          app: {
            appearance: {
              ...TEST_SETTINGS.app?.appearance,
              theme: 'dark',
            },
            ...TEST_SETTINGS.project,
            onboarding_status: 'dismissed',
          },
          project: {
            ...TEST_SETTINGS.project,
            directory: TEST_SETTINGS.project?.directory,
          },
        },
      }),
      IS_PLAYWRIGHT_KEY,
      layoutName: `${LAYOUT_PERSIST_PREFIX}default`,
      layoutPayload: JSON.stringify({
        version: 'v1',
        layout: playwrightLayoutConfig,
      } satisfies LayoutWithMetadata),
    }
  )

  await context.addCookies([
    {
      name: COOKIE_NAME_PREFIX + 'dev.zoo.dev',
      value: token,
      path: '/',
      domain: 'localhost',
      secure: true,
    },
  ])

  failOnConsoleErrors(page, testInfo)
  // kill animations, speeds up tests and reduced flakiness
  await page.emulateMedia({ reducedMotion: 'reduce' })

  // Trigger a navigation, since loading file:// doesn't.
  await page.reload()
}

function failOnConsoleErrors(page: Page, testInfo?: TestInfo) {
  page.on('pageerror', (exception: any) => {
    if (isErrorWhitelisted(exception)) {
      return
    }
    // Only disable this environment variable if you want to collect console errors
    if (process.env.FAIL_ON_CONSOLE_ERRORS !== 'false') {
      // Use expect to prevent page from closing and not cleaning up
      expect(`An error was detected in the console: \r\n message:${exception.message} \r\n name:${exception.name} \r\n stack:${exception.stack}

        *Either fix the console error or add it to the whitelist defined in ./lib/console-error-whitelist.ts (if the error can be safely ignored)
        `).toEqual('Console error detected')
    } else {
      // Add errors to `test-results/exceptions.txt` as a test artifact
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

async function goToHomePageFromModeling(page: Page) {
  await page.getByTestId('app-logo').click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
}

export function executorInputPath(fileName: string): string {
  return path.join('rust', 'kcl-lib', 'e2e', 'executor', 'inputs', fileName)
}

export function testsInputPath(fileName: string): string {
  return path.join('rust', 'kcl-lib', 'tests', 'inputs', fileName)
}

export function kclSamplesPath(fileName: string): string {
  return path.join('public', 'kcl-samples', fileName)
}

export async function doAndWaitForImageDiff(
  pageOrLocator: Page | Locator,
  fn: () => Promise<unknown>,
  diffCount = 200
) {
  return new Promise<boolean>((resolve) => {
    ;(async () => {
      await pageOrLocator.screenshot({
        path: './e2e/playwright/temp1.png',
        fullPage: true,
      })
      await fn()
      const isImageDiff = async () => {
        await pageOrLocator.screenshot({
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

// TODO: fix type to allow for meta.id in configuration
export function settingsToToml(
  settings: DeepPartial<Configuration | { settings: { meta: { id: string } } }>
) {
  // eslint-disable-next-line no-restricted-syntax
  return TOML.stringify(settings as any)
}

export function tomlToSettings(toml: string): DeepPartial<Configuration> {
  // eslint-disable-next-line no-restricted-syntax
  return TOML.parse(toml)
}

export function tomlToPerProjectSettings(
  toml: string
): DeepPartial<ProjectConfiguration> {
  // eslint-disable-next-line no-restricted-syntax
  return TOML.parse(toml)
}

export function perProjectSettingsToToml(
  settings: DeepPartial<ProjectConfiguration>
) {
  // eslint-disable-next-line no-restricted-syntax
  return TOML.stringify(settings as any)
}

export async function clickElectronNativeMenuById(
  tronApp: ElectronZoo,
  menuId: string
) {
  const clickWasTriggered = await tronApp.electron.evaluate(
    async ({ app }, menuId) => {
      if (!app || !app.applicationMenu) {
        return false
      }
      const menu = app.applicationMenu.getMenuItemById(menuId)
      if (!menu) return false
      menu.click()
      return true
    },
    menuId
  )
  expect(clickWasTriggered).toBe(true)
}

export async function findElectronNativeMenuById(
  tronApp: ElectronZoo,
  menuId: string
) {
  const found = await tronApp.electron.evaluate(async ({ app }, menuId) => {
    if (!app || !app.applicationMenu) {
      return false
    }
    const menu = app.applicationMenu.getMenuItemById(menuId)
    if (!menu) return false
    return true
  }, menuId)
  expect(found).toBe(true)
}

export async function openSettingsExpectText(page: Page, text: string) {
  const settings = page.getByTestId('settings-dialog-panel')
  await expect(settings).toBeVisible()
  // You are viewing the user tab
  const actualText = settings.getByText(text)
  await expect(actualText).toBeVisible()
}

export async function openSettingsExpectLocator(page: Page, selector: string) {
  const settings = page.getByTestId('settings-dialog-panel')
  await expect(settings).toBeVisible()
  // You are viewing the keybindings tab
  const settingsLocator = settings.locator(selector)
  await expect(settingsLocator).toBeVisible()
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

/**
 * Simulate a pan touch gesture from the center of an element.
 *
 * Adapted from Playwright docs: https://playwright.dev/docs/touch-events
 */
export async function panFromCenter(
  locator: Locator,
  deltaX = 0,
  deltaY = 0,
  steps = 5
) {
  const { centerX, centerY } = await locator.evaluate((target: HTMLElement) => {
    const bounds = target.getBoundingClientRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    return { centerX, centerY }
  })

  // Providing only clientX and clientY as the app only cares about those.
  const touches = [
    {
      identifier: 0,
      clientX: centerX,
      clientY: centerY,
    },
  ]
  await locator.dispatchEvent('touchstart', {
    touches,
    changedTouches: touches,
    targetTouches: touches,
  })

  for (let j = 1; j <= steps; j++) {
    const touches = [
      {
        identifier: 0,
        clientX: centerX + (deltaX * j) / steps,
        clientY: centerY + (deltaY * j) / steps,
      },
    ]
    await locator.dispatchEvent('touchmove', {
      touches,
      changedTouches: touches,
      targetTouches: touches,
    })
  }

  await locator.dispatchEvent('touchend')
}

/**
 * Simulate a 2-finger pan touch gesture from the center of an element.
 * with {touchSpacing} pixels between.
 *
 * Adapted from Playwright docs: https://playwright.dev/docs/touch-events
 */
export async function panTwoFingerFromCenter(
  locator: Locator,
  deltaX = 0,
  deltaY = 0,
  steps = 5,
  spacingX = 20
) {
  const { centerX, centerY } = await locator.evaluate((target: HTMLElement) => {
    const bounds = target.getBoundingClientRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    return { centerX, centerY }
  })

  // Providing only clientX and clientY as the app only cares about those.
  const touches = [
    {
      identifier: 0,
      clientX: centerX,
      clientY: centerY,
    },
    {
      identifier: 1,
      clientX: centerX + spacingX,
      clientY: centerY,
    },
  ]
  await locator.dispatchEvent('touchstart', {
    touches,
    changedTouches: touches,
    targetTouches: touches,
  })

  for (let j = 1; j <= steps; j++) {
    const touches = [
      {
        identifier: 0,
        clientX: centerX + (deltaX * j) / steps,
        clientY: centerY + (deltaY * j) / steps,
      },
      {
        identifier: 1,
        clientX: centerX + spacingX + (deltaX * j) / steps,
        clientY: centerY + (deltaY * j) / steps,
      },
    ]
    await locator.dispatchEvent('touchmove', {
      touches,
      changedTouches: touches,
      targetTouches: touches,
    })
  }

  await locator.dispatchEvent('touchend')
}

/**
 * Simulate a pinch touch gesture from the center of an element.
 * Touch points are set horizontally from each other, separated by {startDistance} pixels.
 */
export async function pinchFromCenter(
  locator: Locator,
  startDistance = 100,
  delta = 0,
  steps = 5
) {
  const { centerX, centerY } = await locator.evaluate((target: HTMLElement) => {
    const bounds = target.getBoundingClientRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    return { centerX, centerY }
  })

  // Providing only clientX and clientY as the app only cares about those.
  const touches = [
    {
      identifier: 0,
      clientX: centerX - startDistance / 2,
      clientY: centerY,
    },
    {
      identifier: 1,
      clientX: centerX + startDistance / 2,
      clientY: centerY,
    },
  ]
  await locator.dispatchEvent('touchstart', {
    touches,
    changedTouches: touches,
    targetTouches: touches,
  })

  for (let i = 1; i <= steps; i++) {
    const touches = [
      {
        identifier: 0,
        clientX: centerX - startDistance / 2 + (delta * i) / steps,
        clientY: centerY,
      },
      {
        identifier: 1,
        clientX: centerX + startDistance / 2 + (delta * i) / steps,
        clientY: centerY,
      },
    ]
    await locator.dispatchEvent('touchmove', {
      touches,
      changedTouches: touches,
      targetTouches: touches,
    })
  }

  await locator.dispatchEvent('touchend')
}

// Primarily machinery to click and drag a slider.
// THIS ASSUMES THE SLIDER IS ALWAYS HORIZONTAL.
export const inputRangeValueToCoordinate = async function (
  locator: Locator,
  valueTargetStr: string
): Promise<{
  startPoint: { x: number; y: number }
  offsetFromStartPoint: { x: number; y: number }
}> {
  const bb = await locator.boundingBox()
  if (bb === null)
    throw new Error("Bounding box is null, can't do fucking shit")
  const editable = await locator.isEditable()
  if (!editable) throw new Error('Cannot slide range, element is not editable')
  const visible = await locator.isVisible()
  if (!visible) throw new Error('Cannot slide range, element is not visible')
  await locator.scrollIntoViewIfNeeded()
  const maybeMin = await locator.getAttribute('min')
  const maybeMax = await locator.getAttribute('max')
  const maybeStep = await locator.getAttribute('step')

  let low = maybeMin ? Number(maybeMin) : 0
  low = Number.isNaN(low) ? 0 : low

  let upp = maybeMax ? Number(maybeMax) : 10
  upp = Number.isNaN(upp) ? 10 : upp

  let step = maybeMax ? Number(maybeStep) : 1
  step = Number.isNaN(step) ? 1 : step

  let value = Number(valueTargetStr)
  if (Number.isNaN(value)) throw new Error('value must be a number')

  // into step
  value = value - (value % step)

  // half step down
  value -= Math.trunc(step / 2)

  const scale = await locator.page().evaluate(() => window.devicePixelRatio)
  // measured this value in gimp
  const nub = { width: 14 * scale }

  // 4 is the internal border + padding of the slider
  let offsetX = (bb.width - 4 - nub.width / 2) * (value / (upp + low))

  // map to coordinate
  // relative to element
  const offsetFromStartPoint = {
    x: Math.trunc(offsetX + 0.5),
    // need to land on the scroll nub
    y: bb.height * 0.5,
  }

  const startPoint = {
    x: bb.x + nub.width / 2,
    y: bb.y,
  }

  return {
    startPoint,
    offsetFromStartPoint,
  }
}

export const inputRangeSlideFromCurrentTo = async function (
  locator: Locator,
  valueNext: string
) {
  const valueCurrent = await locator.inputValue()
  // Can't click it if the computer can't see it!
  await locator.scrollIntoViewIfNeeded()
  const from = await inputRangeValueToCoordinate(locator, valueCurrent)
  const to = await inputRangeValueToCoordinate(locator, valueNext)
  // I (lee) want to force the mouse to be up, but who knows who needs otherwise.
  // await locator.page.mouse.up()
  const page = locator.page()
  await page.mouse.move(
    from.startPoint.x + from.offsetFromStartPoint.x,
    from.startPoint.y + from.offsetFromStartPoint.y,
    { steps: 10 }
  )
  await page.mouse.down()
  await page.mouse.move(
    to.startPoint.x + to.offsetFromStartPoint.x,
    to.startPoint.y + to.offsetFromStartPoint.y,
    { steps: 10 }
  )
  await page.mouse.up()
}
