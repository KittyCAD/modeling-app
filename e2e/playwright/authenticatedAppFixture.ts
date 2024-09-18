import type { Page, Locator } from '@playwright/test'
import { expect, test as base } from '@playwright/test'
import { getUtils, setup, tearDown } from './test-utils'
import fsp from 'fs/promises'
import { join } from 'path'

export class AuthenticatedApp {
  private readonly codeContent: Locator
  private readonly extrudeButton: Locator

  constructor(public readonly page: Page) {
    this.codeContent = page.locator('.cm-content')
    this.extrudeButton = page.getByTestId('extrude')
  }

  async initialise(code = '') {
    const u = await getUtils(this.page)
    await this.page.addInitScript(async (code) => {
      localStorage.setItem('persistCode', code)
      ;(window as any).playwrightSkipFilePicker = true
    }, code)

    await this.page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()
  }
  getInputFile = (fileName: string) => {
    return fsp.readFile(
      join('src', 'wasm-lib', 'tests', 'executor', 'inputs', fileName),
      'utf-8'
    )
  }
  makeMouseHelpers = (x: number, y: number) => [
    () => this.page.mouse.click(x, y),
    () => this.page.mouse.move(x, y),
  ]

  /** Likely no where, there's a chance it will click something in the scene, depending what you have in the scene.
   *
   * Expects the viewPort to be 1000x500 */
  clickNoWhere = () => this.page.mouse.click(998, 60)

  // Toolbars
  expectExtrudeButtonToBeDisabled = async () =>
    await expect(this.extrudeButton).toBeDisabled()
  expectExtrudeButtonToBeEnabled = async () =>
    await expect(this.extrudeButton).not.toBeDisabled()
  clickExtrudeButton = async () => await this.extrudeButton.click()

  serialiseCmdBar = async (): Promise<{
    tabNames: Array<string>
    inReview: boolean
    currentArg: string
    currentTab: string
    currentArgValue: string
  }> => {
    const sanitizeString = (str: string) =>
      str.replaceAll(/\n/g, '').replaceAll(/\s+/g, ' ').trim()
    const reviewForm = await this.page.locator('#review-form')
    const getTabs = () =>
      this.page
        .getByTestId('cmd-bar-input-tab')
        .allInnerTexts()
        .then((a) => a.map(sanitizeString))
    if (await reviewForm.isVisible()) {
      return {
        tabNames: await getTabs(),
        inReview: true,
        currentArg: '',
        currentTab: '',
        currentArgValue: '',
      }
    }
    const [currentArg, tabNames, currentTab, currentArgValue] =
      await Promise.all([
        this.page.getByTestId('cmd-bar-arg-name').textContent(),
        getTabs(),
        this.page.locator('[data-is-current-arg="true"]').textContent(),
        this.page.getByTestId('cmd-bar-arg-value').textContent(),
      ])
    return {
      currentArg: sanitizeString(currentArg || ''),
      tabNames: tabNames,
      currentTab: sanitizeString(currentTab || ''),
      currentArgValue: sanitizeString(currentArgValue || ''),
      inReview: false,
    }
  }
  progressCmdBar = async () => {
    if (Math.random() > 0.5) {
      const arrowButton = this.page.getByRole('button', {
        name: 'arrow right Continue',
      })
      // .click()
      if (await arrowButton.isVisible()) {
        await arrowButton.click()
      } else {
        await this.page
          .getByRole('button', { name: 'checkmark Submit command' })
          .click()
      }
    } else {
      await this.page.keyboard.press('Enter')
    }
  }
  expectCodeHighlightedToBe = async (code: string) =>
    await expect
      .poll(async () => {
        const texts = (
          await this.page.getByTestId('hover-highlight').allInnerTexts()
        ).map((s) => s.replace(/\s+/g, '').trim())
        return texts.join('')
      })
      .toBe(code.replace(/\s+/g, '').trim())
  expectActiveLinesToBe = async (lines: Array<string>) => {
    await expect
      .poll(async () => {
        return (await this.page.locator('.cm-activeLine').allInnerTexts()).map(
          (l) => l.trim()
        )
      })
      .toEqual(lines.map((l) => l.trim()))
  }
  private _expectEditorToContain =
    (not = false) =>
    (
      code: string,
      {
        shouldNormalise = false,
        timeout = 5_000,
      }: { shouldNormalise?: boolean; timeout?: number } = {}
    ) => {
      if (!shouldNormalise) {
        const expectStart = expect(this.codeContent)
        if (not) {
          return expectStart.not.toContainText(code, { timeout })
        }
        return expectStart.toContainText(code, { timeout })
      }
      const normalisedCode = code.replaceAll(/\s+/g, ' ').trim()
      const expectStart = expect.poll(() => this.codeContent.textContent(), {
        timeout,
      })
      if (not) {
        return expectStart.not.toContain(normalisedCode)
      }
      return expectStart.toContain(normalisedCode)
    }

  expectEditor = {
    toContain: this._expectEditorToContain(),
    not: { toContain: this._expectEditorToContain(true) },
  }
}

export const test = base.extend<{
  app: AuthenticatedApp
}>({
  app: async ({ page }, use) => {
    const authenticatedApp = new AuthenticatedApp(page)
    await use(authenticatedApp)
  },
})

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

export { expect } from '@playwright/test'
