import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'
import { uuidv4 } from 'lib/utils'
import {
  closeDebugPanel,
  doAndWaitForImageDiff,
  getPixelRGBs,
  openAndClearDebugPanel,
  sendCustomCmd,
} from '../test-utils'

type mouseParams = {
  pixelDiff: number
}

export class SceneFixture {
  public page: Page

  private exeIndicator!: Locator

  constructor(page: Page) {
    this.page = page
    this.reConstruct(page)
  }
  reConstruct = (page: Page) => {
    this.page = page

    this.exeIndicator = page.getByTestId('model-state-indicator-execution-done')
  }

  makeMouseHelpers = (
    x: number,
    y: number,
    { steps }: { steps: number } = { steps: 5000 }
  ) =>
    [
      (clickParams?: mouseParams) => {
        if (clickParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () => this.page.mouse.click(x, y),
            clickParams.pixelDiff
          )
        }
        return this.page.mouse.click(x, y)
      },
      (moveParams?: mouseParams) => {
        if (moveParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () => this.page.mouse.move(x, y, { steps }),
            moveParams.pixelDiff
          )
        }
        return this.page.mouse.move(x, y, { steps })
      },
    ] as const

  /** Likely no where, there's a chance it will click something in the scene, depending what you have in the scene.
   *
   * Expects the viewPort to be 1000x500 */
  clickNoWhere = () => this.page.mouse.click(998, 60)
  /** Likely no where, there's a chance it will click something in the scene, depending what you have in the scene.
   *
   * Expects the viewPort to be 1000x500 */
  moveNoWhere = (steps?: number) => this.page.mouse.move(998, 60, { steps })

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

  expectPixelColor = async (
    colour: [number, number, number],
    coords: { x: number; y: number },
    diff: number
  ) => {
    let finalValue = colour
    await expect
      .poll(async () => {
        const pixel = (await getPixelRGBs(this.page)(coords, 1))[0]
        if (!pixel) return null
        finalValue = pixel
        return pixel.every(
          (channel, index) => Math.abs(channel - colour[index]) < diff
        )
      })
      .toBeTruthy()
      .catch((e) => {
        console.error(
          `Error is ExpectPixelColor: expecting ${colour} got ${finalValue}`
        )
        throw e
      })
  }
}
