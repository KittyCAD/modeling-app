import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'
import { uuidv4 } from 'lib/utils'
import {
  closeDebugPanel,
  doAndWaitForImageDiff,
  openAndClearDebugPanel,
  sendCustomCmd,
} from './test-utils'

type mouseParams = {
  pixelDiff: number
}

export class SceneFixture {
  public readonly page: Page
  private readonly exeIndicator: Locator

  constructor(page: Page) {
    this.page = page
    this.exeIndicator = page.getByTestId('model-state-indicator-execution-done')
  }

  makeMouseHelpers = (
    x: number,
    y: number,
    { steps }: { steps: number } = { steps: 5000 }
  ) => [
    (params?: mouseParams) => {
      if (params?.pixelDiff) {
        return doAndWaitForImageDiff(
          this.page,
          () => this.page.mouse.click(x, y),
          params.pixelDiff
        )
      }
      return this.page.mouse.click(x, y)
    },
    (params?: mouseParams) => {
      if (params?.pixelDiff) {
        return doAndWaitForImageDiff(
          this.page,
          () => this.page.mouse.move(x, y, { steps }),
          params.pixelDiff
        )
      }
      return this.page.mouse.move(x, y, { steps })
    },
  ]

  /** Likely no where, there's a chance it will click something in the scene, depending what you have in the scene.
   *
   * Expects the viewPort to be 1000x500 */
  clickNoWhere = () => this.page.mouse.click(998, 60)

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

  moveCameraTo = async (
    pos: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
  ) => {
    await openAndClearDebugPanel(this.page)
    await doAndWaitForImageDiff(
      this.page,
      () =>
        sendCustomCmd(this.page, {
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
    await closeDebugPanel(this.page)
  }
  waitForExecutionDone = async () => {
    await expect(this.exeIndicator).toBeVisible()
  }
}
