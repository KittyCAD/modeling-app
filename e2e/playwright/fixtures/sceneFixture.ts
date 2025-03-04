import type { Page, Locator } from '@playwright/test'
import { expect } from '../zoo-test'
import { isArray, uuidv4 } from 'lib/utils'
import {
  closeDebugPanel,
  doAndWaitForImageDiff,
  getPixelRGBs,
  openAndClearDebugPanel,
  sendCustomCmd,
  getUtils,
} from '../test-utils'

type MouseParams = {
  pixelDiff?: number
  shouldDbClick?: boolean
  delay?: number
}
type MouseDragToParams = MouseParams & {
  fromPoint: { x: number; y: number }
}
type MouseDragFromParams = MouseParams & {
  toPoint: { x: number; y: number }
}

type SceneSerialised = {
  camera: {
    position: [number, number, number]
    target: [number, number, number]
  }
}

type ClickHandler = (clickParams?: MouseParams) => Promise<void | boolean>
type MoveHandler = (moveParams?: MouseParams) => Promise<void | boolean>
type DblClickHandler = (clickParams?: MouseParams) => Promise<void | boolean>
type DragToHandler = (dragParams: MouseDragToParams) => Promise<void | boolean>
type DragFromHandler = (
  dragParams: MouseDragFromParams
) => Promise<void | boolean>

export class SceneFixture {
  public page: Page
  public streamWrapper!: Locator
  public loadingIndicator!: Locator
  public networkToggleConnected!: Locator
  public startEditSketchBtn!: Locator

  get exeIndicator() {
    return this.page
      .getByTestId('model-state-indicator-execution-done')
      .or(this.page.getByTestId('model-state-indicator-receive-reliable'))
  }

  constructor(page: Page) {
    this.page = page
    this.reConstruct(page)
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

    this.streamWrapper = page.getByTestId('stream')
    this.networkToggleConnected = page.getByTestId('network-toggle-ok')
    this.loadingIndicator = this.streamWrapper.getByTestId('loading')
    this.startEditSketchBtn = page
      .getByRole('button', { name: 'Start Sketch' })
      .or(page.getByRole('button', { name: 'Edit Sketch' }))
  }

  makeMouseHelpers = (
    x: number,
    y: number,
    { steps }: { steps: number } = { steps: 20 }
  ): [ClickHandler, MoveHandler, DblClickHandler] =>
    [
      (clickParams?: MouseParams) => {
        if (clickParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () =>
              clickParams?.shouldDbClick
                ? this.page.mouse.dblclick(x, y, {
                    delay: clickParams?.delay || 0,
                  })
                : this.page.mouse.click(x, y, {
                    delay: clickParams?.delay || 0,
                  }),
            clickParams.pixelDiff
          )
        }
        return clickParams?.shouldDbClick
          ? this.page.mouse.dblclick(x, y, { delay: clickParams?.delay || 0 })
          : this.page.mouse.click(x, y, { delay: clickParams?.delay || 0 })
      },
      (moveParams?: MouseParams) => {
        if (moveParams?.pixelDiff) {
          return doAndWaitForImageDiff(
            this.page,
            () => this.page.mouse.move(x, y, { steps }),
            moveParams.pixelDiff
          )
        }
        return this.page.mouse.move(x, y, { steps })
      },
      (clickParams?: MouseParams) => {
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
      (dragToParams: MouseDragToParams) => {
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
      (dragFromParams: MouseDragFromParams) => {
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

  connectionEstablished = async () => {
    const timeout = 30000
    await expect(this.networkToggleConnected).toBeVisible({ timeout })
  }

  settled = async (cmdBar) => {
    const u = await getUtils(this.page)

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('Settings · app · show debug panel')
    await cmdBar.selectOption({ name: 'on' }).click()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.clearAndCloseDebugPanel()

    await this.waitForExecutionDone()
    await expect(this.startEditSketchBtn).not.toBeDisabled()
    await expect(this.startEditSketchBtn).toBeVisible()
  }

  expectPixelColor = async (
    colour: [number, number, number] | [number, number, number][],
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
}

function isColourArray(
  colour: [number, number, number] | [number, number, number][]
): colour is [number, number, number][] {
  return isArray(colour[0])
}

export async function expectPixelColor(
  page: Page,
  colour: [number, number, number] | [number, number, number][],
  coords: { x: number; y: number },
  diff: number
) {
  let finalValue = colour
  await expect
    .poll(
      async () => {
        const pixel = (await getPixelRGBs(page)(coords, 1))[0]
        if (!pixel) return null
        finalValue = pixel
        if (!isColourArray(colour)) {
          return pixel.every(
            (channel, index) => Math.abs(channel - colour[index]) < diff
          )
        }
        return colour.some((c) =>
          c.every((channel, index) => Math.abs(pixel[index] - channel) < diff)
        )
      },
      { timeout: 10_000 }
    )
    .toBeTruthy()
    .catch((cause) => {
      throw new Error(
        `ExpectPixelColor: expecting ${colour} got ${finalValue}`,
        { cause }
      )
    })
}
