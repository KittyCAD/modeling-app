import type { Page, Locator } from '@playwright/test'
import { expect, test as base } from '@playwright/test'
import { getUtils, setup, tearDown } from './test-utils'
import fsp from 'fs/promises'
import { join } from 'path'
import { uuidv4 } from 'lib/utils'

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
  private readonly exeIndicator: Locator

  private readonly diagnosticsTooltip: Locator
  private readonly diagnosticsGutterIcon: Locator

  private readonly codeContent: Locator
  private readonly extrudeButton: Locator
  readonly startSketchBtn: Locator
  readonly rectangleBtn: Locator
  readonly exitSketchBtn: Locator
  u: Awaited<ReturnType<typeof getUtils>>

  constructor(public readonly page: Page) {
    this.codeContent = page.locator('.cm-content')
    this.extrudeButton = page.getByTestId('extrude')
    this.startSketchBtn = page.getByTestId('sketch')
    this.rectangleBtn = page.getByTestId('corner-rectangle')
    this.exitSketchBtn = page.getByTestId('sketch-exit')
    this.exeIndicator = page.getByTestId('model-state-indicator-execution-done')
    this.diagnosticsTooltip = page.locator('.cm-tooltip-lint')
    // this.diagnosticsTooltip = page.locator('.cm-tooltip')
    this.diagnosticsGutterIcon = page.locator('.cm-lint-marker-error')

    this.u = {} as any
  }

  async initialise(code = '') {
    const u = await getUtils(this.page)
    this.u = u

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
  makeMouseHelpers = (
    x: number,
    y: number,
    { steps }: { steps: number } = { steps: 5000 }
  ) => [
    () => this.page.mouse.click(x, y),
    () => this.page.mouse.move(x, y, { steps }),
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
  expectCodeHighlightedToBe = async (
    code: string,
    { timeout }: { timeout: number } = { timeout: 5000 }
  ) =>
    await expect
      .poll(
        async () => {
          const texts = (
            await this.page.getByTestId('hover-highlight').allInnerTexts()
          ).map((s) => s.replace(/\s+/g, '').trim())
          return texts.join('')
        },
        { timeout }
      )
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
      const normalisedCode = code.replaceAll(/\s+/g, '').trim()
      const expectStart = expect.poll(
        async () => {
          const editorText = await this.codeContent.textContent()
          return editorText?.replaceAll(/\s+/g, '').trim()
        },
        {
          timeout,
        }
      )
      if (not) {
        return expectStart.not.toContain(normalisedCode)
      }
      return expectStart.toContain(normalisedCode)
    }

  expectEditor = {
    toContain: this._expectEditorToContain(),
    not: { toContain: this._expectEditorToContain(true) },
  }

  moveCameraTo = async (
    pos: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
  ) => {
    await this.u.openAndClearDebugPanel()
    await this.u.doAndWaitForImageDiff(
      () =>
        this.u.sendCustomCmd({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_look_at',
            vantage: pos,
            center: target,
            up: { x: 0, y: 0, z: 1 },
          },
        }),
      300
    )
    await this.u.closeDebugPanel()
  }
  waitForExecutionDone = async () => {
    await expect(this.exeIndicator).toBeVisible()
  }
  private _serialiseDiagnostics = async (): Promise<Array<string>> => {
    const diagnostics = await this.diagnosticsGutterIcon.all()
    const diagnosticsContent: string[] = []
    for (const diag of diagnostics) {
      await diag.hover()
      // await expect(this.diagnosticsTooltip)
      const content = await this.diagnosticsTooltip.allTextContents()
      diagnosticsContent.push(content.join(''))
    }
    return [...new Set(diagnosticsContent)].map((d) => d.trim())
  }
  expectDiagnosticsToBe = async (expected: Array<string>) =>
    await expect
      .poll(async () => {
        const result = await this._serialiseDiagnostics()
        return result
      })
      .toEqual(expected.map((e) => e.trim()))
  startSketchPlaneSelection = async () =>
    this.u.doAndWaitForImageDiff(() => this.startSketchBtn.click(), 500)
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
