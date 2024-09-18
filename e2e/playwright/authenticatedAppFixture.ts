import type { Page, Locator } from '@playwright/test'
import { expect, test as base } from '@playwright/test'
import { getUtils, setup, tearDown } from './test-utils'
import fsp from 'fs/promises'
import { join } from 'path'

type CmdBarSerilised =
  | {
      stage: 'commandBarClosed'
      // TODO no more properties needed but needs to be implemented in _serialiseCmdBar
    }
  | {
      stage: 'pickCommand'
      // TODO this will need more properties when implemented in _serialiseCmdBar
    }
  | {
      stage: 'arguments'
      currentArgKey: string
      currentArgValue: string
      headerArguments: Record<string, string>
      highlightedHeaderArg: string
      commandName: string
    }
  | {
      stage: 'review'
      headerArguments: Record<string, string>
      commandName: string
    }

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

  private _serialiseCmdBar = async (): Promise<CmdBarSerilised> => {
    const reviewForm = await this.page.locator('#review-form')
    const getHeaderArgs = async () => {
      const inputs = await this.page.getByTestId('cmd-bar-input-tab').all()
      const entries = await Promise.all(
        inputs.map((input) => {
          const key = input
            .locator('[data-test-name="arg-name"]')
            .innerText()
            .then((a) => a.trim())
          const value = input
            .getByTestId('header-arg-value')
            .innerText()
            .then((a) => a.trim())
          return Promise.all([key, value])
        })
      )
      return Object.fromEntries(entries)
    }
    const getCommandName = () =>
      this.page.getByTestId('command-name').textContent()
    if (await reviewForm.isVisible()) {
      const [headerArguments, commandName] = await Promise.all([
        getHeaderArgs(),
        getCommandName(),
      ])
      return {
        stage: 'review',
        headerArguments,
        commandName: commandName || '',
      }
    }
    const [
      currentArgKey,
      currentArgValue,
      headerArguments,
      highlightedHeaderArg,
      commandName,
    ] = await Promise.all([
      this.page.getByTestId('cmd-bar-arg-name').textContent(),
      this.page.getByTestId('cmd-bar-arg-value').textContent(),
      getHeaderArgs(),
      this.page
        .locator('[data-is-current-arg="true"]')
        .locator('[data-test-name="arg-name"]')
        .textContent(),
      getCommandName(),
    ])
    return {
      stage: 'arguments',
      currentArgKey: currentArgKey || '',
      currentArgValue: currentArgValue || '',
      headerArguments,
      highlightedHeaderArg: highlightedHeaderArg || '',
      commandName: commandName || '',
    }
  }
  expectCmdBarToBe = async (expected: CmdBarSerilised) => {
    return expect.poll(() => this._serialiseCmdBar()).toEqual(expected)
  }
  progressCmdBar = async () => {
    if (Math.random() > 0.5) {
      const arrowButton = this.page.getByRole('button', {
        name: 'arrow right Continue',
      })
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
