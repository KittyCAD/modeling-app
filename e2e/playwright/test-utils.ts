import { waitForAuth } from '@e2e/playwright/lib/appSetup'
import {
  clearCommandLogs,
  closeDebugPanel,
  expectCmdLog,
  openAndClearDebugPanel,
  openDebugPanel,
  sendCustomCmd,
  waitForCmdReceive,
} from '@e2e/playwright/lib/debugSupport'
import {
  closeKclCodePanel,
  editorSelector,
  openKclCodePanel,
  removeCurrentCode,
  toNormalizedCode,
} from '@e2e/playwright/lib/editorSupport'
import {
  convertPagePositionToStream,
  doAndWaitForImageDiff,
  getPixelRGBs,
} from '@e2e/playwright/lib/imageAssertions'
import type {
  PaneId} from '@e2e/playwright/lib/paneSupport'
import {
  closeFilePanel,
  openFilePanel,
  openLogsPane,
  openPane,
  openVariablesPane,
} from '@e2e/playwright/lib/paneSupport'
import { goToHomePageFromModeling } from '@e2e/playwright/lib/projectSupport'
import { waitForPageLoad } from '@e2e/playwright/lib/sceneSupport'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { expect, test } from '@playwright/test'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { SIDEBAR_BUTTON_SUFFIX } from '@src/lib/constants'
import type { Protocol } from 'playwright-core/types/protocol'
import { PNG } from 'pngjs'

export async function getUtils(page: Page, test_?: typeof test) {
  if (!test) {
    console.warn(
      'Some methods in getUtils requires test object as second argument'
    )
  }

  const util = {
    waitForAuth: () => waitForAuth(page),
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
      const screenshot = PNG.sync.read(buffer)
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

    async editorTextMatches(this: void, code: string) {
      const editor = page.locator(editorSelector)
      return expect
        .poll(async () => {
          try {
            const text = await editor.textContent()
            return toNormalizedCode(text ?? '')
          } catch (e) {
            console.log(e)
            return ''
          }
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
        await expect
          .poll(() =>
            page.evaluate((name) => {
              const current = window.app.project?.executingPath
              const basename = current ? window.fsZds.basename(current) : ''
              return basename === name || basename === `${name}.kcl`
            }, name)
          )
          .toBe(true)
        await expect(page.locator(editorSelector)).toBeEditable()
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

    panesOpen: async (paneIds: string[]) => {
      return test?.step(`Setting ${paneIds} panes to be open`, async () => {
        for (const paneId of paneIds) {
          await openPane(page, paneId + SIDEBAR_BUTTON_SUFFIX)
        }
      })
    },
  }

  return util
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
