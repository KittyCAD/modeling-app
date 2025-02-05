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
  pixelDiff?: number
}
type mouseDragToParams = mouseParams & {
  fromPoint: { x: number; y: number }
}
type mouseDragFromParams = mouseParams & {
  toPoint: { x: number; y: number }
}

type SceneSerialised = {
  camera: {
    position: [number, number, number]
    target: [number, number, number]
  }
}

type ClickHandler = (clickParams?: mouseParams) => Promise<void | boolean>
type MoveHandler = (moveParams?: mouseParams) => Promise<void | boolean>
type DblClickHandler = (clickParams?: mouseParams) => Promise<void | boolean>
type DragToHandler = (dragParams: mouseDragToParams) => Promise<void | boolean>
type DragFromHandler = (
  dragParams: mouseDragFromParams
) => Promise<void | boolean>

export class SceneFixture {
  public page: Page
  public streamWrapper!: Locator
  public loadingIndicator!: Locator
  private exeIndicator!: Locator
  public overlay!: Node | null

  constructor(page: Page) {
    this.page = page
    this.reConstruct(page)
    this.overlay = null
  }
  private _serialiseScene = async (): Promise<SceneSerialised> => {
    const camera = await this.getCameraInfo()

    return {
      camera,
    }
  }

  expectState = async (expected: SceneSerialised) => {
    return expect
      .poll(async () => await this._serialiseScene(), {
        intervals: [1_000, 2_000, 10_000],
        timeout: 60000,
      })
      .toEqual(expected)
  }

  reConstruct = (page: Page) => {
    this.page = page

    this.exeIndicator = page.getByTestId('model-state-indicator-execution-done')
    this.streamWrapper = page.getByTestId('stream')
    this.loadingIndicator = this.streamWrapper.getByTestId('loading')
  }

  makeMouseHelpers = (
    x: number,
    y: number,
    { steps }: { steps: number } = { steps: 20 }
  ): [ClickHandler, MoveHandler, DblClickHandler] =>
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
      (clickParams?: mouseParams) => {
        if (clickParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () => this.page.mouse.dblclick(x, y),
            clickParams.pixelDiff
          )
        }
        return this.page.mouse.dblclick(x, y)
      },
    ] as const
  makeDragHelpers = (
    x: number,
    y: number,
    { steps }: { steps: number } = { steps: 20 }
  ): [DragToHandler, DragFromHandler] =>
    [
      (dragToParams: mouseDragToParams) => {
        if (dragToParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () =>
              this.page.dragAndDrop('#stream', '#stream', {
                sourcePosition: dragToParams.fromPoint,
                targetPosition: { x, y },
              }),
            dragToParams.pixelDiff
          )
        }
        return this.page.dragAndDrop('#stream', '#stream', {
          sourcePosition: dragToParams.fromPoint,
          targetPosition: { x, y },
        })
      },
      (dragFromParams: mouseDragFromParams) => {
        if (dragFromParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () =>
              this.page.dragAndDrop('#stream', '#stream', {
                sourcePosition: { x, y },
                targetPosition: dragFromParams.toPoint,
              }),
            dragFromParams.pixelDiff
          )
        }
        return this.page.dragAndDrop('#stream', '#stream', {
          sourcePosition: { x, y },
          targetPosition: dragFromParams.toPoint,
        })
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
  /** Forces a refresh of the camera position and target displayed
   *  in the debug panel and then returns the values of the fields
   */
  async getCameraInfo() {
    await openAndClearDebugPanel(this.page)
    await sendCustomCmd(this.page, {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await this.page
      .locator(`[data-receive-command-type="default_camera_get_settings"]`)
      .first()
      .waitFor()
    const position = await Promise.all([
      this.page.getByTestId('cam-x-position').inputValue().then(Number),
      this.page.getByTestId('cam-y-position').inputValue().then(Number),
      this.page.getByTestId('cam-z-position').inputValue().then(Number),
    ])
    const target = await Promise.all([
      this.page.getByTestId('cam-x-target').inputValue().then(Number),
      this.page.getByTestId('cam-y-target').inputValue().then(Number),
      this.page.getByTestId('cam-z-target').inputValue().then(Number),
    ])
    await closeDebugPanel(this.page)
    return {
      position,
      target,
    }
  }

  waitForExecutionDone = async () => {
    await expect(this.exeIndicator).toBeVisible({ timeout: 30000 })
  }

  expectPixelColor = async (
    colour: [number, number, number],
    coords: { x: number; y: number },
    diff: number
  ) => {
    await expectPixelColor(this.page, colour, coords, diff)
  }

  get gizmo() {
    return this.page.locator('[aria-label*=gizmo]')
  }

  async clickGizmoMenuItem(name: string) {
    await this.gizmo.hover()
    await this.gizmo.click({ button: 'right' })
    const buttonToTest = this.page.getByRole('button', {
      name: name,
    })
    await expect(buttonToTest).toBeVisible()
    await buttonToTest.click()
  }

  drawCanvas = async () => {
    await this.page.evaluate(() => {
      var canvas = document.querySelector('[data-engine="three.js r172"]')
      // insert at global document level and pointer events through it...
      // make overlay
      var parentElement = canvas?.parentElement
      var overlayCanvas = canvas?.cloneNode()
      this.overlay = overlayCanvas
      if (overlayCanvas) {
        overlayCanvas.style.top = '0px'
        overlayCanvas.style.position = 'absolute'
        overlayCanvas.style.pointerEvents = 'none'
        overlayCanvas.style.zIndex = '99999999'
        document.body.prepend(overlayCanvas)
        let ctx = overlayCanvas.getContext('2d')
        ctx.lineWidth = 3
        ctx.strokeStyle = '#FF0000'
        ctx.beginPath()
        ctx.arc(500, 250, 10, 0, 2 * Math.PI, false)
        ctx.stroke()
      }
    })
  }
}

export async function expectPixelColor(
  page: Page,
  colour: [number, number, number],
  coords: { x: number; y: number },
  diff: number
) {
  let finalValue = colour
  await expect
    .poll(async () => {
      const pixel = (await getPixelRGBs(page)(coords, 1))[0]
      if (!pixel) return null
      finalValue = pixel
      return pixel.every(
        (channel, index) => Math.abs(channel - colour[index]) < diff
      )
    })
    .toBeTruthy()
    .catch((cause) => {
      throw new Error(
        `ExpectPixelColor: expecting ${colour} got ${finalValue}`,
        { cause }
      )
    })
}
